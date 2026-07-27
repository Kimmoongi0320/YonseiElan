import { getSupabaseServerClient } from "./supabase/server";
import type { DayKey } from "./schedule";

export type DayAttendanceStatus = "present" | "absent" | "none";
export type AttendanceOverrideStatus = "present" | "absent";

export type DayAttendanceInfo = {
  status: DayAttendanceStatus;
  checkInAt: number | null;
  checkOutAt: number | null;
  // Set when this (absent) day has a makeup class scheduled on another date.
  makeupDate: string | null;
  // Non-empty when this day IS the scheduled makeup date for one or more
  // absences on other dates (multiple absences can share one makeup day).
  makeupForDates: string[];
  // True once the relevant makeup date has an actual check-in — read on
  // whichever side (the absence day via makeupDate, or the target day via
  // makeupForDates) is currently being displayed.
  makeupCompleted: boolean;
  // The student's class_days as of when this absence/makeup override was
  // last created or edited. Null for rows never touched since this column
  // was added, or for days with no override at all — callers should fall
  // back to the student's current class_days in that case.
  classDaysSnapshot: DayKey[] | null;
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
    makeupForDates: [],
    makeupCompleted: false,
    classDaysSnapshot: null,
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
    supabase
      .from("attendance_overrides")
      .select("date, status, makeup_date, class_days_snapshot")
      .eq("student_id", studentId),
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

  // A makeup also counts as completed when the admin manually marked that day
  // present via an override, even without an actual check-in record.
  const presentOverrideDates = new Set(overrides.filter((o) => o.status === "present").map((o) => o.date));
  const isMakeupCompleted = (date: string) => completedMakeupDates.has(date) || presentOverrideDates.has(date);

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
      entry.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
      if (entry.makeupDate) {
        entry.makeupCompleted = isMakeupCompleted(entry.makeupDate);
      }
    }

    if (override.makeup_date && override.makeup_date >= startDate && override.makeup_date < endDate) {
      const entry = ensure(override.makeup_date);
      entry.makeupForDates.push(override.date);
      entry.makeupCompleted = isMakeupCompleted(override.makeup_date);
      entry.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
    }
  }

  for (const entry of Object.values(result)) entry.makeupForDates.sort();

  return result;
}

function parseDateStr(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

// Returns a { date: info } map scoped to just the given dates, instead of a
// whole month. Used to hand back the effect of a single edit (the day that
// changed plus any makeup-linked day) without re-querying the entire month.
export async function getDatesAttendanceInfo(
  studentId: string,
  dates: string[]
): Promise<Record<string, DayAttendanceInfo>> {
  const uniqueDates = Array.from(new Set(dates)).filter((d) => DATE_RE.test(d));
  if (uniqueDates.length === 0) return {};

  const supabase = getSupabaseServerClient();

  const recordsOrFilter = uniqueDates
    .map((dateStr) => {
      const { year, month, day } = parseDateStr(dateStr);
      const dayStart = kstMidnightIso(year, month, day);
      const dayEnd = kstMidnightIso(year, month, day + 1);
      return `and(check_in_at.gte.${dayStart},check_in_at.lt.${dayEnd})`;
    })
    .join(",");

  const [recordsResult, ownOverridesResult, linkedOverridesResult] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("check_in_at, check_out_at")
      .eq("student_id", studentId)
      .or(recordsOrFilter),
    supabase
      .from("attendance_overrides")
      .select("date, status, makeup_date, class_days_snapshot")
      .eq("student_id", studentId)
      .in("date", uniqueDates),
    // A date passed in can be the makeup side of an absence whose own date
    // isn't in `uniqueDates` (e.g. the admin marks the makeup day present
    // directly) — this pulls in that absence row so it gets refreshed too.
    supabase
      .from("attendance_overrides")
      .select("date, status, makeup_date, class_days_snapshot")
      .eq("student_id", studentId)
      .in("makeup_date", uniqueDates),
  ]);

  if (recordsResult.error) throw recordsResult.error;
  if (ownOverridesResult.error) throw ownOverridesResult.error;
  if (linkedOverridesResult.error) throw linkedOverridesResult.error;

  const result: Record<string, DayAttendanceInfo> = {};
  const ensure = (date: string): DayAttendanceInfo => {
    if (!result[date]) result[date] = emptyDayInfo();
    return result[date];
  };

  for (const date of uniqueDates) ensure(date);

  const checkInDates = new Set<string>();
  for (const record of recordsResult.data ?? []) {
    const date = kstDateString(new Date(record.check_in_at).getTime());
    checkInDates.add(date);
    const entry = ensure(date);
    entry.status = "present";
    entry.checkInAt = new Date(record.check_in_at).getTime();
    entry.checkOutAt = record.check_out_at ? new Date(record.check_out_at).getTime() : null;
  }

  // The same override row can surface from both queries above (its own date
  // and its makeup date can both land in `uniqueDates`) — dedupe by date.
  const overridesByDate = new Map(
    [...(ownOverridesResult.data ?? []), ...(linkedOverridesResult.data ?? [])].map((o) => [o.date, o])
  );
  const overrides = Array.from(overridesByDate.values());

  // A makeup also counts as completed when the admin manually marked that day
  // present via an override, even without an actual check-in record.
  const presentOverrideDates = new Set(overrides.filter((o) => o.status === "present").map((o) => o.date));
  const isMakeupCompleted = (date: string) => checkInDates.has(date) || presentOverrideDates.has(date);

  for (const override of overrides) {
    const entry = ensure(override.date);
    entry.status = override.status as DayAttendanceStatus;
    entry.makeupDate = override.status === "absent" ? override.makeup_date : null;
    entry.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
    if (entry.makeupDate) {
      entry.makeupCompleted = isMakeupCompleted(entry.makeupDate);
    }

    if (override.makeup_date) {
      const target = ensure(override.makeup_date);
      target.makeupForDates.push(override.date);
      target.makeupCompleted = isMakeupCompleted(override.makeup_date);
      target.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
    }
  }

  for (const entry of Object.values(result)) entry.makeupForDates.sort();

  return result;
}

export async function setAttendanceOverride(
  studentId: string,
  date: string,
  status: AttendanceOverrideStatus,
  makeupDate: string | null = null
): Promise<Record<string, DayAttendanceInfo>> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");
  if (makeupDate !== null && !DATE_RE.test(makeupDate)) throw new Error("Invalid makeup date");

  const supabase = getSupabaseServerClient();

  const [{ data: prior, error: priorError }, { data: studentRow, error: studentError }] = await Promise.all([
    supabase.from("attendance_overrides").select("makeup_date").eq("student_id", studentId).eq("date", date).maybeSingle(),
    supabase.from("students").select("class_days").eq("id", studentId).single(),
  ]);
  if (priorError) throw priorError;
  if (studentError) throw studentError;

  const { error } = await supabase.from("attendance_overrides").upsert(
    {
      student_id: studentId,
      date,
      status,
      makeup_date: status === "absent" ? makeupDate : null,
      // Recorded fresh on every save so this row always reflects the class
      // schedule as of whenever an admin last touched it, not today's live
      // schedule if it's since changed.
      class_days_snapshot: studentRow.class_days,
    },
    { onConflict: "student_id,date" }
  );

  if (error) throw error;

  const affectedDates = [date, prior?.makeup_date ?? null, status === "absent" ? makeupDate : null].filter(
    (d): d is string => d != null
  );
  return getDatesAttendanceInfo(studentId, affectedDates);
}

// Updates only the makeup date on an existing absence override. A no-op if
// the day isn't currently marked absent (there's nothing to attach a makeup
// date to).
export async function setAttendanceMakeupDate(
  studentId: string,
  date: string,
  makeupDate: string | null
): Promise<Record<string, DayAttendanceInfo>> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");
  if (makeupDate !== null && !DATE_RE.test(makeupDate)) throw new Error("Invalid makeup date");

  const supabase = getSupabaseServerClient();

  const [{ data: prior, error: priorError }, { data: studentRow, error: studentError }] = await Promise.all([
    supabase
      .from("attendance_overrides")
      .select("makeup_date")
      .eq("student_id", studentId)
      .eq("date", date)
      .eq("status", "absent")
      .maybeSingle(),
    supabase.from("students").select("class_days").eq("id", studentId).single(),
  ]);
  if (priorError) throw priorError;
  if (studentError) throw studentError;

  const { error } = await supabase
    .from("attendance_overrides")
    .update({ makeup_date: makeupDate, class_days_snapshot: studentRow.class_days })
    .eq("student_id", studentId)
    .eq("date", date)
    .eq("status", "absent");

  if (error) throw error;

  const affectedDates = [date, prior?.makeup_date ?? null, makeupDate].filter((d): d is string => d != null);
  return getDatesAttendanceInfo(studentId, affectedDates);
}

export async function clearAttendanceOverride(
  studentId: string,
  date: string
): Promise<Record<string, DayAttendanceInfo>> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");

  const supabase = getSupabaseServerClient();

  // .select() on the delete returns the row as it existed just before
  // removal, so the makeup_date it carried can be read in the same
  // round trip instead of a separate select beforehand.
  const { data: deleted, error } = await supabase
    .from("attendance_overrides")
    .delete()
    .eq("student_id", studentId)
    .eq("date", date)
    .select("makeup_date")
    .maybeSingle();

  if (error) throw error;

  const affectedDates = [date, deleted?.makeup_date ?? null].filter((d): d is string => d != null);
  return getDatesAttendanceInfo(studentId, affectedDates);
}
