import { getSupabaseServerClient } from "./supabase/server";
import type { ClassTimes, DayKey } from "./schedule";

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
  classTimes: ClassTimes;
  paymentDay: number | null;
  startDate: string;
  // True once today (KST) has reached startDate — the admin form must treat
  // startDate as read-only from that point on.
  startDateLocked: boolean;
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
  classTimes: ClassTimes;
  paymentDay: number | null;
  startDate: string;
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

// "YYYY-MM-DD" for today in KST — used to decide whether a student's
// start_date has already passed (and its edit lock should apply).
export function todayKstDateStr(nowMs: number = Date.now()): string {
  return startOfTodayKstIso(nowMs).slice(0, 10);
}

export type StudentLookupResult = {
  id: string;
  name: string;
  age: number | null;
  classDays: DayKey[];
};

export async function findStudentsByPhone(phoneLast4: string): Promise<StudentLookupResult[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, name, age, class_days")
    .eq("parent_phone_last4", phoneLast4)
    .eq("is_active", true);

  if (error) throw error;

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    age: s.age,
    classDays: (s.class_days ?? []) as DayKey[],
  }));
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

// Narrow lookup for upsertStudentAction's start_date lock check — kept
// separate from findStudentById (used by the kiosk check-in flow above),
// which has no need for start_date.
export async function findStudentForEdit(id: string): Promise<{ id: string; startDate: string } | null> {
  if (!UUID_RE.test(id)) return null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, start_date")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { id: data.id, startDate: data.start_date };
}

export type AdminStudentSummary = Pick<AdminStudent, "id" | "name" | "classDays" | "paymentDay" | "startDate">;

export async function getStudentSummaryForAdmin(id: string): Promise<AdminStudentSummary | null> {
  if (!UUID_RE.test(id)) return null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, name, class_days, payment_day, start_date")
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
    startDate: data.start_date,
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
        "id, name, age, parent_phone, memo, class_days, class_times, payment_day, start_date, attendance_records(check_in_at, check_out_at)"
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
  const todayKst = todayKstDateStr(now);

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
      classTimes: (s.class_times ?? {}) as ClassTimes,
      paymentDay: s.payment_day,
      startDate: s.start_date,
      startDateLocked: s.start_date <= todayKst,
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
    class_times: input.classTimes,
    payment_day: input.paymentDay,
    start_date: input.startDate,
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
      class_times: input.classTimes,
      payment_day: input.paymentDay,
      start_date: input.startDate,
    })
    .eq("id", id);

  if (error) throw error;
}

export async function deleteStudent(id: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("students").delete().eq("id", id);

  if (error) throw error;
}

export type ScheduleStudent = Pick<AdminStudent, "id" | "name" | "classDays" | "classTimes">;

// Backs the admin-wide schedule calendar (app/admin/dashboard/schedule) — only
// the fields needed to derive each day's regular timetable, not the
// attendance/session-count data listStudentsForAdmin also fetches.
export async function listActiveStudentsForSchedule(): Promise<ScheduleStudent[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("students")
    .select("id, name, class_days, class_times")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    classDays: (s.class_days ?? []) as DayKey[],
    classTimes: (s.class_times ?? {}) as ClassTimes,
  }));
}
