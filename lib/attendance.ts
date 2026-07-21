import { getSupabaseServerClient } from "./supabase/server";
import { CHECK_OUT_WAIT_MS } from "./constants";

type AttendanceRecord = {
  checkInAt: number;
  checkOutAt: number | null;
};

const UNIQUE_VIOLATION = "23505";

export async function getActiveRecord(studentId: string): Promise<AttendanceRecord | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("check_in_at, check_out_at")
    .eq("student_id", studentId)
    .is("check_out_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { checkInAt: new Date(data.check_in_at).getTime(), checkOutAt: null };
}

export async function checkIn(studentId: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .insert({ student_id: studentId })
    .select("check_in_at")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false as const, reason: "already-checked-in" as const };
    }
    throw error;
  }

  return {
    ok: true as const,
    record: { checkInAt: new Date(data.check_in_at).getTime(), checkOutAt: null },
  };
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
