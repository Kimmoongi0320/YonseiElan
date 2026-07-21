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
  status: AttendanceStatus;
  checkInAt: number | null;
  checkOutAt: number | null;
};

export type StudentInput = {
  name: string;
  age: number | null;
  parentPhone: string;
  memo: string;
  classDays: DayKey[];
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

export async function listStudentsForAdmin(): Promise<AdminStudent[]> {
  const supabase = getSupabaseServerClient();
  const now = Date.now();

  // Single round trip: fetch students with today's attendance records embedded,
  // instead of a students query followed by a dependent attendance_records query.
  const { data: students, error } = await supabase
    .from("students")
    .select(
      "id, name, age, parent_phone, memo, class_days, attendance_records(check_in_at, check_out_at)"
    )
    .eq("is_active", true)
    .gte("attendance_records.check_in_at", startOfTodayKstIso(now))
    .order("name", { ascending: true })
    .order("check_in_at", { ascending: false, referencedTable: "attendance_records" });

  if (error) throw error;
  if (!students || students.length === 0) return [];

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
      status,
      checkInAt,
      checkOutAt,
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
    })
    .eq("id", id);

  if (error) throw error;
}

export async function deleteStudent(id: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("students").delete().eq("id", id);

  if (error) throw error;
}
