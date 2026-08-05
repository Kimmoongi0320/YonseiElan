import { getSupabaseServerClient } from "./supabase/server";
import { isTodayInKst } from "./students";
import { CHECK_OUT_WAIT_MS, CHECKIN_CUTOFF_HOUR_KST } from "./constants";

type AttendanceRecord = {
  checkInAt: number;
  checkOutAt: number | null;
};

type OpenAttendanceRecord = {
  id: string;
  checkInAt: number;
};

const UNIQUE_VIOLATION = "23505";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CHECKIN_CUTOFF_MESSAGE = "운영 시간이 종료되어 등원 처리가 불가능합니다";
const CONCURRENT_CHECKIN_MESSAGE = "처리 중 다른 등원 기록이 확인되었습니다. 다시 시도해주세요";

// KST has no DST, so a fixed UTC+9 shift is always correct.
function getKstHour(nowMs: number): number {
  return new Date(nowMs + KST_OFFSET_MS).getUTCHours();
}

// The instant that 22:00 KST falls on, on the KST calendar day that `checkInAtMs` belongs to.
function kstClosingTimeMs(checkInAtMs: number): number {
  const kstDayIndex = Math.floor((checkInAtMs + KST_OFFSET_MS) / 86_400_000);
  const kstMidnightMs = kstDayIndex * 86_400_000 - KST_OFFSET_MS;
  return kstMidnightMs + CHECKIN_CUTOFF_HOUR_KST * 60 * 60 * 1000;
}

// The UTC instant that today's KST midnight falls on.
function startOfTodayKstIso(nowMs: number): string {
  const kstDayIndex = Math.floor((nowMs + KST_OFFSET_MS) / 86_400_000);
  return new Date(kstDayIndex * 86_400_000 - KST_OFFSET_MS).toISOString();
}

export async function getOpenRecord(studentId: string): Promise<OpenAttendanceRecord | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, check_in_at")
    .eq("student_id", studentId)
    .is("check_out_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { id: data.id, checkInAt: new Date(data.check_in_at).getTime() };
}

// Whether today's check-in/check-out cycle is already closed out. Read
// alongside getOpenRecord (both independent, studentId-keyed reads) rather
// than only after finding no open record, so callers can fetch the two in
// parallel instead of sequentially.
export async function getAlreadyCompletedToday(studentId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("check_in_at")
    .eq("student_id", studentId)
    .gte("check_in_at", startOfTodayKstIso(Date.now()))
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

// Closes out a stale (pre-today) open record left behind by a failed 22:00
// auto-checkout cron run, so the student can check in again today. Scoped to
// the specific record id and still-open state, so it's a no-op if the cron
// (or a racing request) already closed it out from under us.
async function closeStaleRecord(record: OpenAttendanceRecord, nowMs: number): Promise<void> {
  const checkOutAtMs = Math.min(kstClosingTimeMs(record.checkInAt), nowMs);

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("attendance_records")
    .update({ check_out_at: new Date(checkOutAtMs).toISOString() })
    .eq("id", record.id)
    .is("check_out_at", null);

  if (error) throw error;
}

async function insertCheckInRecord(studentId: string, conflictMessage?: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .insert({ student_id: studentId })
    .select("id, check_in_at")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false as const,
        reason: "already-checked-in" as const,
        ...(conflictMessage ? { message: conflictMessage } : {}),
      };
    }
    throw error;
  }

  return {
    ok: true as const,
    record: { id: data.id, checkInAt: new Date(data.check_in_at).getTime(), checkOutAt: null },
  };
}

// `open` is fetched by the caller (in parallel with the student lookup),
// rather than here, so the two independent reads don't run sequentially.
export async function checkIn(studentId: string, open: OpenAttendanceRecord | null) {
  if (getKstHour(Date.now()) >= CHECKIN_CUTOFF_HOUR_KST) {
    return { ok: false as const, reason: "after-hours" as const, message: CHECKIN_CUTOFF_MESSAGE };
  }

  const now = Date.now();

  if (open) {
    if (isTodayInKst(new Date(open.checkInAt).toISOString(), now)) {
      return { ok: false as const, reason: "already-checked-in" as const };
    }

    // Stale record from before today (cron failure or multi-day absence) — close
    // it out ourselves, then fall through to a normal check-in.
    await closeStaleRecord(open, now);
    return insertCheckInRecord(studentId, CONCURRENT_CHECKIN_MESSAGE);
  }

  return insertCheckInRecord(studentId);
}

async function performCheckOut(studentId: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .update({ check_out_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .is("check_out_at", null)
    .select("id, check_in_at, check_out_at")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    checkInAt: new Date(data.check_in_at).getTime(),
    checkOutAt: new Date(data.check_out_at as string).getTime(),
  };
}

// `active` is fetched by the caller (in parallel with the student lookup),
// rather than here, so the two independent reads don't run sequentially.
export async function checkOut(studentId: string, active: AttendanceRecord | null) {
  if (!active) {
    return { ok: false as const, reason: "not-checked-in" as const };
  }

  const elapsedMs = Date.now() - active.checkInAt;
  if (elapsedMs < CHECK_OUT_WAIT_MS) {
    return {
      ok: false as const,
      reason: "too-early" as const,
      remainingMs: CHECK_OUT_WAIT_MS - elapsedMs,
    };
  }

  return { ok: true as const, record: await performCheckOut(studentId) };
}

// Admin-triggered check-out, used from the dashboard to release a student
// before the normal wait period has elapsed. No elapsed-time gate to check,
// so the open-record lookup and the check-out itself are folded into a
// single conditional update instead of a separate select + update.
export async function adminCheckOut(studentId: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .update({ check_out_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .is("check_out_at", null)
    .select("check_in_at, check_out_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { ok: false as const, reason: "not-checked-in" as const };
  }

  return {
    ok: true as const,
    record: {
      checkInAt: new Date(data.check_in_at).getTime(),
      checkOutAt: new Date(data.check_out_at as string).getTime(),
    },
  };
}

export type AdminBulkCheckOutRecord = {
  studentId: string;
  checkInAt: number;
  checkOutAt: number;
};

// Bulk counterpart to adminCheckOut, used by the dashboard's checkbox-driven
// "전체 하원 처리". One update covering every selected student instead of N
// round trips; students with no open record (already checked out, or never
// checked in today) simply don't match and are silently skipped, same as the
// single-student version.
export async function adminBulkCheckOut(studentIds: string[]): Promise<AdminBulkCheckOutRecord[]> {
  if (studentIds.length === 0) return [];

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .update({ check_out_at: new Date().toISOString() })
    .in("student_id", studentIds)
    .is("check_out_at", null)
    .select("student_id, check_in_at, check_out_at");

  if (error) throw error;

  return (data ?? []).map((r) => ({
    studentId: r.student_id,
    checkInAt: new Date(r.check_in_at).getTime(),
    checkOutAt: new Date(r.check_out_at as string).getTime(),
  }));
}

// Backs the admin's "present" override for TODAY specifically (set via the
// per-student attendance calendar): without this, marking a student present
// only wrote to attendance_overrides, leaving the dashboard's live status —
// which reads solely from attendance_records — stuck on "미등원" even though
// the calendar showed them present. Creates a real check-in so the two views
// agree, unless one already exists for today (open or closed), in which case
// this is a no-op. No operating-hours cutoff, since this is an explicit
// admin correction rather than a self-service check-in.
//
// Returns the new check-in's timestamp, or null if this was a no-op (already
// recorded) — the caller uses that to decide whether an arrival alert is due.
export async function adminMarkPresentToday(studentId: string): Promise<number | null> {
  const now = Date.now();

  const open = await getOpenRecord(studentId);
  if (open) {
    if (isTodayInKst(new Date(open.checkInAt).toISOString(), now)) return null;
    await closeStaleRecord(open, now);
  } else {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("attendance_records")
      .select("id")
      .eq("student_id", studentId)
      .gte("check_in_at", startOfTodayKstIso(now))
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return null;
  }

  const result = await insertCheckInRecord(studentId);
  return result.ok ? result.record.checkInAt : null;
}

export type AttendanceAction = "check-in" | "check-out";

// Kiosk single-tap flow: the student taps their name and the system decides
// which half of the day's cycle comes next, instead of making them pick a
// mode up front. No record today -> check-in; an open record from today ->
// check-out; today's cycle already closed -> reported back with no write,
// so a stray extra tap can't create a second record for the same day.
//
// `open` and `alreadyCompletedToday` are fetched by the caller (in parallel
// with the student lookup), rather than here, so the independent reads that
// precede the actual write don't run one after another.
export async function resolveAttendance(
  studentId: string,
  open: OpenAttendanceRecord | null,
  alreadyCompletedToday: boolean,
) {
  const now = Date.now();

  if (open) {
    if (isTodayInKst(new Date(open.checkInAt).toISOString(), now)) {
      const result = await checkOut(studentId, { checkInAt: open.checkInAt, checkOutAt: null });
      return { ...result, action: "check-out" as const };
    }

    // Stale record from before today — checkIn() closes it out and inserts a fresh one.
    const result = await checkIn(studentId, open);
    return { ...result, action: "check-in" as const };
  }

  if (alreadyCompletedToday) {
    return { ok: false as const, action: "already-completed" as const, reason: "already-completed" as const };
  }

  const result = await checkIn(studentId, null);
  return { ...result, action: "check-in" as const };
}

// Reverses a just-made kiosk tap within the undo window. Scoped to the
// specific record id (and student, defense in depth) so it can't ever touch
// a different check-in/out made in the meantime.
export async function undoCheckIn(recordId: string, studentId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("attendance_records")
    .delete()
    .eq("id", recordId)
    .eq("student_id", studentId)
    .is("check_out_at", null);
  if (error) throw error;
}

// Used by the arrival-alert scheduler to check, after the undo window has
// passed, whether the check-in survived — a "취소" tap deletes the row via
// undoCheckIn above, which is how a cancellation suppresses the alert.
export async function recordExists(recordId: string, studentId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("id", recordId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

// Used by the alert scheduler to check, after the undo window has passed,
// whether a checkout survived — a "취소" tap reverts check_out_at back to
// null via undoCheckOut below, which is how a cancellation suppresses the
// departure alert.
export async function isCheckedOut(recordId: string, studentId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("check_out_at")
    .eq("id", recordId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw error;
  return data?.check_out_at != null;
}

export async function undoCheckOut(recordId: string, studentId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("attendance_records")
    .update({ check_out_at: null })
    .eq("id", recordId)
    .eq("student_id", studentId);
  if (error) throw error;
}
