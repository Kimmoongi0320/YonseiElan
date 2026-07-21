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

async function getOpenRecord(studentId: string): Promise<OpenAttendanceRecord | null> {
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

export async function getActiveRecord(studentId: string): Promise<AttendanceRecord | null> {
  const open = await getOpenRecord(studentId);
  if (!open) return null;

  return { checkInAt: open.checkInAt, checkOutAt: null };
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
    .select("check_in_at")
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
    record: { checkInAt: new Date(data.check_in_at).getTime(), checkOutAt: null },
  };
}

export async function checkIn(studentId: string) {
  if (getKstHour(Date.now()) >= CHECKIN_CUTOFF_HOUR_KST) {
    return { ok: false as const, reason: "after-hours" as const, message: CHECKIN_CUTOFF_MESSAGE };
  }

  const now = Date.now();
  const open = await getOpenRecord(studentId);

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
    .select("check_in_at, check_out_at")
    .single();

  if (error) throw error;

  return {
    checkInAt: new Date(data.check_in_at).getTime(),
    checkOutAt: new Date(data.check_out_at as string).getTime(),
  };
}

export async function checkOut(studentId: string) {
  const active = await getActiveRecord(studentId);
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
// before the normal wait period has elapsed.
export async function adminCheckOut(studentId: string) {
  const active = await getActiveRecord(studentId);
  if (!active) {
    return { ok: false as const, reason: "not-checked-in" as const };
  }

  return { ok: true as const, record: await performCheckOut(studentId) };
}
