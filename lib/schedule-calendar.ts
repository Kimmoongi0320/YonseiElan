import { getSupabaseServerClient } from "./supabase/server";

export type MonthOverrideRow = {
  studentId: string;
  date: string;
  status: "present" | "absent";
  makeupDate: string | null;
  makeupTime: string | null;
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

// Backs the admin-wide schedule calendar (app/admin/dashboard/schedule).
// Unlike every other query against attendance_overrides — which scopes to one
// student_id first — this queries across ALL students by date range, since
// the schedule page shows every student's day at once. A single OR'd range
// filter (same style as getDatesAttendanceInfo in lib/attendance-calendar.ts)
// covers both:
//   - overrides dated within the month (to know who's marked absent on a
//     regular class day within the month)
//   - overrides whose makeup_date falls within the month, even if the
//     original absence happened in an earlier/later month
export async function getMonthScheduleOverrides(year: number, month: number): Promise<MonthOverrideRow[]> {
  const startDate = ymd(year, month, 1);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = ymd(nextYear, nextMonth, 1);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("attendance_overrides")
    .select("student_id, date, status, makeup_date, makeup_time")
    .or(
      `and(date.gte.${startDate},date.lt.${endDate}),and(makeup_date.gte.${startDate},makeup_date.lt.${endDate})`
    );

  if (error) throw error;

  return (data ?? []).map((row) => ({
    studentId: row.student_id,
    date: row.date,
    status: row.status as "present" | "absent",
    makeupDate: row.makeup_date,
    makeupTime: row.makeup_time,
  }));
}
