import { getSupabaseServerClient } from "./supabase/server";

export type DayAttendanceStatus = "present" | "absent" | "none";
export type AttendanceOverrideStatus = "present" | "absent";

export type DayAttendanceInfo = {
  status: DayAttendanceStatus;
  checkInAt: number | null;
  checkOutAt: number | null;
  // Set when this (absent) day has a makeup class scheduled on another date.
  makeupDate: string | null;
  // Set when this day IS the scheduled makeup date for an absence on another date.
  makeupForDate: string | null;
  // True once the relevant makeup date has an actual check-in — read on
  // whichever side (the absence day via makeupDate, or the target day via
  // makeupForDate) is currently being displayed.
  makeupCompleted: boolean;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

// The UTC instant that KST midnight falls on, for the given KST calendar date.
function kstMidnightIso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS).toISOString();
}

function kstDateString(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function emptyDayInfo(): DayAttendanceInfo {
  return {
    status: "none",
    checkInAt: null,
    checkOutAt: null,
    makeupDate: null,
    makeupForDate: null,
    makeupCompleted: false,
  };
}

// Returns a { date: info } map for every day in the given KST month that has
// an attendance record, an admin override, or is the target of a makeup date
// scheduled from an absence (which may fall in a different month). An admin
// override takes precedence over the auto-derived status from a check-in.
export async function getStudentMonthAttendance(
  studentId: string,
  year: number,
  month: number
): Promise<Record<string, DayAttendanceInfo>> {
  const supabase = getSupabaseServerClient();

  const startIso = kstMidnightIso(year, month, 1);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endIso = kstMidnightIso(nextYear, nextMonth, 1);
  const startDate = ymd(year, month, 1);
  const endDate = ymd(nextYear, nextMonth, 1);

  const [recordsResult, overridesResult] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("check_in_at, check_out_at")
      .eq("student_id", studentId)
      .gte("check_in_at", startIso)
      .lt("check_in_at", endIso)
      .order("check_in_at", { ascending: true }),
    // Fetched unbounded (not month-filtered): a makeup date can point at a
    // different month than the absence itself, so we need every override to
    // resolve makeup links that cross a month boundary.
    supabase.from("attendance_overrides").select("date, status, makeup_date").eq("student_id", studentId),
  ]);

  if (recordsResult.error) throw recordsResult.error;
  if (overridesResult.error) throw overridesResult.error;

  const overrides = overridesResult.data ?? [];

  // Whether a makeup was completed depends on a check-in on the makeup date,
  // which can fall in a month other than the one currently displayed (either
  // the absence's month or the makeup's own month). Resolve it directly
  // instead of relying on the month-scoped attendance_records fetch above.
  const distinctMakeupDates = Array.from(
    new Set(overrides.map((o) => o.makeup_date).filter((d): d is string => d != null))
  );
  const completedMakeupDates = new Set<string>();
  if (distinctMakeupDates.length > 0) {
    const orFilter = distinctMakeupDates
      .map((dateStr) => {
        const { year, month: m, day } = parseDateStr(dateStr);
        const dayStart = kstMidnightIso(year, m, day);
        const dayEnd = kstMidnightIso(year, m, day + 1);
        return `and(check_in_at.gte.${dayStart},check_in_at.lt.${dayEnd})`;
      })
      .join(",");

    const { data, error } = await supabase
      .from("attendance_records")
      .select("check_in_at")
      .eq("student_id", studentId)
      .or(orFilter);

    if (error) throw error;
    for (const record of data ?? []) {
      completedMakeupDates.add(kstDateString(new Date(record.check_in_at).getTime()));
    }
  }

  const result: Record<string, DayAttendanceInfo> = {};
  const ensure = (date: string): DayAttendanceInfo => {
    if (!result[date]) result[date] = emptyDayInfo();
    return result[date];
  };

  for (const record of recordsResult.data ?? []) {
    const date = kstDateString(new Date(record.check_in_at).getTime());
    const entry = ensure(date);
    entry.status = "present";
    entry.checkInAt = new Date(record.check_in_at).getTime();
    entry.checkOutAt = record.check_out_at ? new Date(record.check_out_at).getTime() : null;
  }

  for (const override of overrides) {
    if (override.date >= startDate && override.date < endDate) {
      const entry = ensure(override.date);
      entry.status = override.status as DayAttendanceStatus;
      entry.makeupDate = override.status === "absent" ? override.makeup_date : null;
      if (entry.makeupDate) {
        entry.makeupCompleted = completedMakeupDates.has(entry.makeupDate);
      }
    }

    if (override.makeup_date && override.makeup_date >= startDate && override.makeup_date < endDate) {
      const entry = ensure(override.makeup_date);
      entry.makeupForDate = override.date;
      entry.makeupCompleted = completedMakeupDates.has(override.makeup_date);
    }
  }

  return result;
}

function parseDateStr(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

export async function setAttendanceOverride(
  studentId: string,
  date: string,
  status: AttendanceOverrideStatus,
  makeupDate: string | null = null
): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");
  if (makeupDate !== null && !DATE_RE.test(makeupDate)) throw new Error("Invalid makeup date");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("attendance_overrides").upsert(
    {
      student_id: studentId,
      date,
      status,
      makeup_date: status === "absent" ? makeupDate : null,
    },
    { onConflict: "student_id,date" }
  );

  if (error) throw error;
}

// Updates only the makeup date on an existing absence override. A no-op if
// the day isn't currently marked absent (there's nothing to attach a makeup
// date to).
export async function setAttendanceMakeupDate(
  studentId: string,
  date: string,
  makeupDate: string | null
): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");
  if (makeupDate !== null && !DATE_RE.test(makeupDate)) throw new Error("Invalid makeup date");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("attendance_overrides")
    .update({ makeup_date: makeupDate })
    .eq("student_id", studentId)
    .eq("date", date)
    .eq("status", "absent");

  if (error) throw error;
}

export async function clearAttendanceOverride(studentId: string, date: string): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("attendance_overrides")
    .delete()
    .eq("student_id", studentId)
    .eq("date", date);

  if (error) throw error;
}
