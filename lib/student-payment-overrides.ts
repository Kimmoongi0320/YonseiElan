import { getSupabaseServerClient } from "./supabase/server";

export type StudentPaymentOverride = {
  id: string;
  studentId: string;
  paymentDate: string;
};

export type StudentPaymentOverrideResult = { error: string } | { override: StudentPaymentOverride };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function todayKstStr(): string {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function monthRange(year: number, month: number): { start: string; nextStart: string } {
  const start = `${year}-${pad2(month)}-01`;
  const nextStart = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return { start, nextStart };
}

function toStudentPaymentOverride(row: { id: string; student_id: string; payment_date: string }): StudentPaymentOverride {
  return { id: row.id, studentId: row.student_id, paymentDate: row.payment_date };
}

export async function listStudentPaymentOverrides(studentId: string): Promise<StudentPaymentOverride[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_payment_overrides")
    .select("id, student_id, payment_date")
    .eq("student_id", studentId)
    .order("payment_date", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toStudentPaymentOverride);
}

// Freezes every past, not-yet-recorded payment cycle up through yesterday
// (KST) into student_payment_overrides, and rolls students.payment_day
// forward to match (see freeze_student_payment_history in
// supabase/schema.sql) — called whenever a student's attendance calendar is
// opened, regardless of which month is being viewed, so history never falls
// behind. A no-op after the first catch-up call for a given day.
export async function freezeStudentPaymentHistory(studentId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.rpc("freeze_student_payment_history", {
    p_student_id: studentId,
    p_ref_date: todayKstStr(),
  });

  if (error) throw error;
}

// Sets this student's confirmed payment date for the given calendar month —
// replacing any existing override in that same month first, so setting one
// always means "this month's date is X" rather than silently accumulating a
// second date in the same month (which would otherwise create an
// unintended extra short cycle boundary).
export async function setStudentPaymentOverride(
  studentId: string,
  year: number,
  month: number,
  paymentDate: string
): Promise<StudentPaymentOverrideResult> {
  if (!DATE_RE.test(paymentDate)) return { error: "날짜 형식이 올바르지 않습니다." };

  const supabase = getSupabaseServerClient();
  const { start, nextStart } = monthRange(year, month);

  const { error: deleteError } = await supabase
    .from("student_payment_overrides")
    .delete()
    .eq("student_id", studentId)
    .gte("payment_date", start)
    .lt("payment_date", nextStart);
  if (deleteError) throw deleteError;

  const { data, error } = await supabase
    .from("student_payment_overrides")
    .insert({ student_id: studentId, payment_date: paymentDate })
    .select("id, student_id, payment_date")
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
