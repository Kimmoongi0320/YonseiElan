import { getSupabaseServerClient } from "./supabase/server";

export type StudentPaymentOverride = {
  id: string;
  studentId: string;
  cycleMonth: string;
  paymentDate: string;
};

export type StudentPaymentOverrideResult = { error: string } | { override: StudentPaymentOverride };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function lastDayOfMonthStr(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function toStudentPaymentOverride(row: {
  id: string;
  student_id: string;
  cycle_month: string;
  payment_date: string;
}): StudentPaymentOverride {
  return { id: row.id, studentId: row.student_id, cycleMonth: row.cycle_month, paymentDate: row.payment_date };
}

export async function listStudentPaymentOverrides(studentId: string): Promise<StudentPaymentOverride[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_payment_overrides")
    .select("id, student_id, cycle_month, payment_date")
    .eq("student_id", studentId)
    .order("cycle_month", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toStudentPaymentOverride);
}

// Lazily freezes a past month's resolved payment date (see
// freeze_student_payment_month in supabase/schema.sql) instead of a nightly
// cron sweeping every student — this only does real work the first time a
// given past month's calendar is actually viewed; every call after that (or
// any call for the current/a future month) is a cheap no-op on the DB side.
export async function freezeStudentPaymentMonthIfEnded(studentId: string, year: number, month: number): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.rpc("freeze_student_payment_month", {
    p_student_id: studentId,
    p_month_end: lastDayOfMonthStr(year, month),
  });

  if (error) throw error;
}

// Upserts on (student_id, cycle_month) — setting an override for a month
// that already has one just moves the date rather than erroring.
export async function setStudentPaymentOverride(
  studentId: string,
  cycleMonth: string,
  paymentDate: string
): Promise<StudentPaymentOverrideResult> {
  if (!DATE_RE.test(cycleMonth) || !DATE_RE.test(paymentDate)) return { error: "날짜 형식이 올바르지 않습니다." };

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_payment_overrides")
    .upsert(
      { student_id: studentId, cycle_month: cycleMonth, payment_date: paymentDate },
      { onConflict: "student_id,cycle_month" }
    )
    .select("id, student_id, cycle_month, payment_date")
    .single();

  if (error) throw error;
  return { override: toStudentPaymentOverride(data) };
}

// Reverts a month back to the default payment_day rule.
export async function deleteStudentPaymentOverride(studentId: string, overrideId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("student_payment_overrides")
    .delete()
    .eq("id", overrideId)
    .eq("student_id", studentId);

  if (error) throw error;
}
