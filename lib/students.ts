import { getSupabaseServerClient } from "./supabase/server";
import type { DayKey } from "./schedule";

export type Student = {
  id: string;
  name: string;
  parentPhone: string;
};

export type AttendanceStatus = "checked_in" | "checked_out" | "not_arrived";

export type AdminStudent = {
  id: string;
  name: string;
  age: number | null;
  parentPhone: string;
  memo: string;
  classDays: DayKey[];
  paymentDay: number | null;
  status: AttendanceStatus;
  checkInAt: number | null;
  checkOutAt: number | null;
  // Count of days marked present since the most recent payment_day, through
  // today (the current billing cycle). Null when the student has no
  // payment_day set (there's no cycle to count within).
  sessionCount: number | null;
};

export type StudentInput = {
  name: string;
  age: number | null;
  parentPhone: string;
  memo: string;
  classDays: DayKey[];
  paymentDay: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isTodayInKst(iso: string, nowMs: number): boolean {
  const kstDay = (ms: number) => Math.floor((ms + KST_OFFSET_MS) / 86_400_000);
  return kstDay(new Date(iso).getTime()) === kstDay(nowMs);
}

function startOfTodayKstIso(nowMs: number): string {
  const kstDayIndex = Math.floor((nowMs + KST_OFFSET_MS) / 86_400_000);
  const kstMidnightUtcMs = kstDayIndex * 86_400_000 - KST_OFFSET_MS;
  return new Date(kstMidnightUtcMs).toISOString();
}

export async function findStudentsByPhone(phoneLast4: string): Promise<Student[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, name, parent_phone")
    .eq("parent_phone_last4", phoneLast4)
    .eq("is_active", true);

  if (error) throw error;

  return (data ?? []).map((s) => ({ id: s.id, name: s.name, parentPhone: s.parent_phone }));
}

export async function findStudentById(id: string): Promise<Student | null> {
  if (!UUID_RE.test(id)) return null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, name, parent_phone")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { id: data.id, name: data.name, parentPhone: data.parent_phone };
}

export type AdminStudentSummary = Pick<AdminStudent, "id" | "name" | "classDays" | "paymentDay">;

export async function getStudentSummaryForAdmin(id: string): Promise<AdminStudentSummary | null> {
  if (!UUID_RE.test(id)) return null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, name, class_days, payment_day")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    classDays: (data.class_days ?? []) as DayKey[],
    paymentDay: data.payment_day,
  };
}

export async function listStudentsForAdmin(): Promise<AdminStudent[]> {
  const supabase = getSupabaseServerClient();
  const now = Date.now();

  // Two independent round trips in parallel: students with today's
  // attendance embedded, and per-student session counts computed in SQL
  // (see get_student_session_counts in supabase/schema.sql) — the latter
  // returns one row per student regardless of attendance history size.
  const [studentsResult, sessionCountsResult] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, name, age, parent_phone, memo, class_days, payment_day, attendance_records(check_in_at, check_out_at)"
      )
      .eq("is_active", true)
      .gte("attendance_records.check_in_at", startOfTodayKstIso(now))
      .order("name", { ascending: true })
      .order("check_in_at", { ascending: false, referencedTable: "attendance_records" }),
    supabase.rpc("get_student_session_counts"),
  ]);

  if (studentsResult.error) throw studentsResult.error;
  if (sessionCountsResult.error) throw sessionCountsResult.error;

  const students = studentsResult.data;
  if (!students || students.length === 0) return [];

  const sessionCountByStudent = new Map(
    (sessionCountsResult.data ?? []).map((r) => [r.student_id, r.session_count])
  );

  return students.map((s) => {
    const latest = s.attendance_records?.[0];
    let status: AttendanceStatus = "not_arrived";
    let checkInAt: number | null = null;
    let checkOutAt: number | null = null;

    if (latest && isTodayInKst(latest.check_in_at, now)) {
      checkInAt = new Date(latest.check_in_at).getTime();
      if (!latest.check_out_at) {
        status = "checked_in";
      } else {
        status = "checked_out";
        checkOutAt = new Date(latest.check_out_at).getTime();
      }
    }

    return {
      id: s.id,
      name: s.name,
      age: s.age,
      parentPhone: s.parent_phone,
      memo: s.memo ?? "",
      classDays: (s.class_days ?? []) as DayKey[],
      paymentDay: s.payment_day,
      status,
      checkInAt,
      checkOutAt,
      sessionCount: sessionCountByStudent.get(s.id) ?? null,
    };
  });
}

export async function createStudent(input: StudentInput): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("students").insert({
    name: input.name,
    age: input.age,
    parent_phone: input.parentPhone,
    memo: input.memo || null,
    class_days: input.classDays,
    payment_day: input.paymentDay,
  });

  if (error) throw error;
}

export async function updateStudent(id: string, input: StudentInput): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("students")
    .update({
      name: input.name,
      age: input.age,
      parent_phone: input.parentPhone,
      memo: input.memo || null,
      class_days: input.classDays,
      payment_day: input.paymentDay,
    })
    .eq("id", id);

  if (error) throw error;
}

export async function deleteStudent(id: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("students").delete().eq("id", id);

  if (error) throw error;
}
