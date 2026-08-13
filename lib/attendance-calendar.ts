import { getSupabaseServerClient } from "./supabase/server";
import { adminMarkPresentToday } from "./attendance";
import { sendAdminAttendanceAlert } from "./attendance-alert";
import { findStudentById } from "./students";
import { TIME_RE, type DayKey } from "./schedule";

export type DayAttendanceStatus = "present" | "absent" | "none";
export type AttendanceOverrideStatus = "present" | "absent";

export type DayAttendanceInfo = {
  status: DayAttendanceStatus;
  checkInAt: number | null;
  checkOutAt: number | null;
  // Set when this (absent) day has a makeup class scheduled on another date.
  makeupDate: string | null;
  // The scheduled time ("HH:MM") of that makeup class. Null whenever
  // makeupDate is null.
  makeupTime: string | null;
  // Whether this (absent) day is a makeup candidate at all. Admin-set,
  // defaults to true; flipped to false for absences that policy doesn't
  // grant a makeup for (e.g. a same-day absence). Always true when status
  // isn't "absent". False forces makeupDate/makeupTime to null.
  makeupRequired: boolean;
  // Non-empty when this day IS the scheduled makeup date for one or more
  // absences on other dates (multiple absences can share one makeup day,
  // in principle at different times each).
  makeupForDates: { date: string; time: string | null }[];
  // True once THIS day's own scheduled makeup (at makeupDate) has an actual
  // check-in or present override. Only meaningful when makeupDate is set —
  // read when displaying this day in its role as the absence.
  makeupCompleted: boolean;
  // True once THIS day itself has an actual check-in or present override.
  // Only meaningful when makeupForDates is non-empty — read when displaying
  // this day in its role as the makeup destination for other absences.
  // Kept separate from makeupCompleted because a single day can be both an
  // absence with its own pending makeup AND the makeup target for another
  // absence at the same time, and those two roles can have different
  // answers (e.g. this day's own makeup is done, but this day itself, being
  // absent, was never attended).
  targetFulfilled: boolean;
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
    makeupTime: null,
    makeupRequired: true,
    makeupForDates: [],
    makeupCompleted: false,
    targetFulfilled: false,
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
      .select("date, status, makeup_date, makeup_time, makeup_required, class_days_snapshot")
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
      entry.makeupTime = override.status === "absent" ? override.makeup_time : null;
      entry.makeupRequired = override.status === "absent" ? override.makeup_required : true;
      entry.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
      if (entry.makeupDate) {
        entry.makeupCompleted = isMakeupCompleted(entry.makeupDate);
      }
    }

    if (override.makeup_date && override.makeup_date >= startDate && override.makeup_date < endDate) {
      const entry = ensure(override.makeup_date);
      entry.makeupForDates.push({ date: override.date, time: override.makeup_time });
      entry.targetFulfilled = isMakeupCompleted(override.makeup_date);
      entry.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
    }
  }

  for (const entry of Object.values(result)) entry.makeupForDates.sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

function parseDateStr(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

// Returns a { date: info } map scoped to the given seed dates, PLUS every
// date reachable from them through the makeup-date graph. Used to hand back
// the effect of a single edit without re-querying the whole month.
//
// Fetches every override row for this student (unbounded — same trivial-cost
// pattern getStudentMonthAttendance uses) rather than walking the makeup
// chain one hop at a time from the seed dates. A hop-limited lookup used to
// live here, but it broke down for chains longer than one link (e.g. day A's
// makeup is day B, and day B's own makeup is day C): editing day C would
// refresh day B correctly, but couldn't discover day A, so day B's returned
// entry — missing the link back to A — would overwrite the client's correct
// cached copy and make A's pending-makeup indicator vanish. Resolving the
// full graph up front avoids that class of bug entirely.
export async function getDatesAttendanceInfo(
  studentId: string,
  dates: string[]
): Promise<Record<string, DayAttendanceInfo>> {
  const seedDates = Array.from(new Set(dates)).filter((d) => DATE_RE.test(d));
  if (seedDates.length === 0) return {};

  const supabase = getSupabaseServerClient();

  const { data: overridesData, error: overridesError } = await supabase
    .from("attendance_overrides")
    .select("date, status, makeup_date, makeup_time, makeup_required, class_days_snapshot")
    .eq("student_id", studentId);
  if (overridesError) throw overridesError;
  const overrides = overridesData ?? [];

  const relevantDates = new Set(seedDates);
  for (const o of overrides) {
    relevantDates.add(o.date);
    if (o.makeup_date) relevantDates.add(o.makeup_date);
  }

  const recordsOrFilter = Array.from(relevantDates)
    .map((dateStr) => {
      const { year, month, day } = parseDateStr(dateStr);
      const dayStart = kstMidnightIso(year, month, day);
      const dayEnd = kstMidnightIso(year, month, day + 1);
      return `and(check_in_at.gte.${dayStart},check_in_at.lt.${dayEnd})`;
    })
    .join(",");

  const { data: recordsData, error: recordsError } = await supabase
    .from("attendance_records")
    .select("check_in_at, check_out_at")
    .eq("student_id", studentId)
    .or(recordsOrFilter);
  if (recordsError) throw recordsError;

  const result: Record<string, DayAttendanceInfo> = {};
  const ensure = (date: string): DayAttendanceInfo => {
    if (!result[date]) result[date] = emptyDayInfo();
    return result[date];
  };

  for (const date of relevantDates) ensure(date);

  const checkInDates = new Set<string>();
  for (const record of recordsData ?? []) {
    const date = kstDateString(new Date(record.check_in_at).getTime());
    checkInDates.add(date);
    const entry = ensure(date);
    entry.status = "present";
    entry.checkInAt = new Date(record.check_in_at).getTime();
    entry.checkOutAt = record.check_out_at ? new Date(record.check_out_at).getTime() : null;
  }

  // A makeup also counts as completed when the admin manually marked that day
  // present via an override, even without an actual check-in record.
  const presentOverrideDates = new Set(overrides.filter((o) => o.status === "present").map((o) => o.date));
  const isMakeupCompleted = (date: string) => checkInDates.has(date) || presentOverrideDates.has(date);

  for (const override of overrides) {
    const entry = ensure(override.date);
    entry.status = override.status as DayAttendanceStatus;
    entry.makeupDate = override.status === "absent" ? override.makeup_date : null;
    entry.makeupTime = override.status === "absent" ? override.makeup_time : null;
    entry.makeupRequired = override.status === "absent" ? override.makeup_required : true;
    entry.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
    if (entry.makeupDate) {
      entry.makeupCompleted = isMakeupCompleted(entry.makeupDate);
    }

    if (override.makeup_date) {
      const target = ensure(override.makeup_date);
      target.makeupForDates.push({ date: override.date, time: override.makeup_time });
      target.targetFulfilled = isMakeupCompleted(override.makeup_date);
      target.classDaysSnapshot = override.class_days_snapshot as DayKey[] | null;
    }
  }

  for (const entry of Object.values(result)) entry.makeupForDates.sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

export async function setAttendanceOverride(
  studentId: string,
  date: string,
  status: AttendanceOverrideStatus,
  makeupDate: string | null = null,
  makeupTime: string | null = null,
  makeupRequired: boolean = true
): Promise<Record<string, DayAttendanceInfo>> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");
  if (makeupDate !== null && !DATE_RE.test(makeupDate)) throw new Error("Invalid makeup date");
  if (makeupDate !== null && (makeupTime === null || !TIME_RE.test(makeupTime))) {
    throw new Error("Invalid makeup time");
  }
  if (makeupDate === null && makeupTime !== null) throw new Error("Makeup time without a makeup date");

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
      makeup_date: status === "absent" && makeupRequired ? makeupDate : null,
      makeup_time: status === "absent" && makeupRequired ? makeupTime : null,
      makeup_required: status === "absent" ? makeupRequired : true,
      // Recorded fresh on every save so this row always reflects the class
      // schedule as of whenever an admin last touched it, not today's live
      // schedule if it's since changed.
      class_days_snapshot: studentRow.class_days,
    },
    { onConflict: "student_id,date" }
  );

  if (error) throw error;

  // Marking today present should also reflect in the dashboard's live
  // check-in status, which is derived from attendance_records rather than
  // this table — see adminMarkPresentToday for why.
  if (status === "present" && date === kstDateString(Date.now())) {
    const checkInAt = await adminMarkPresentToday(studentId);
    if (checkInAt !== null) {
      const student = await findStudentById(studentId);
      if (student) {
        sendAdminAttendanceAlert({
          action: "check-in",
          studentName: student.name,
          parentPhone: student.parentPhone,
          timestamp: checkInAt,
        });
      }
    }
  }

  const affectedDates = [date, prior?.makeup_date ?? null, status === "absent" ? makeupDate : null].filter(
    (d): d is string => d != null
  );
  return getDatesAttendanceInfo(studentId, affectedDates);
}

// Updates only the makeup date/time on an existing absence override. A no-op
// if the day isn't currently marked absent (there's nothing to attach a
// makeup date to). Clearing makeupDate (null) also clears makeupTime.
export async function setAttendanceMakeupDate(
  studentId: string,
  date: string,
  makeupDate: string | null,
  makeupTime: string | null
): Promise<Record<string, DayAttendanceInfo>> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");
  if (makeupDate !== null && !DATE_RE.test(makeupDate)) throw new Error("Invalid makeup date");
  if (makeupDate !== null && (makeupTime === null || !TIME_RE.test(makeupTime))) {
    throw new Error("Invalid makeup time");
  }
  const resolvedMakeupTime = makeupDate === null ? null : makeupTime;

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
    .update({ makeup_date: makeupDate, makeup_time: resolvedMakeupTime, class_days_snapshot: studentRow.class_days })
    .eq("student_id", studentId)
    .eq("date", date)
    .eq("status", "absent");

  if (error) throw error;

  const affectedDates = [date, prior?.makeup_date ?? null, makeupDate].filter((d): d is string => d != null);
  return getDatesAttendanceInfo(studentId, affectedDates);
}

// Updates only whether an existing absence override is a makeup candidate at
// all. A no-op if the day isn't currently marked absent. Turning this off
// also clears any makeup date/time already set, since a not-required
// absence shouldn't carry a pending makeup — turning it back on leaves the
// admin to pick a fresh date rather than reviving the old one.
export async function setAttendanceMakeupRequired(
  studentId: string,
  date: string,
  makeupRequired: boolean
): Promise<Record<string, DayAttendanceInfo>> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");

  const supabase = getSupabaseServerClient();

  const { data: prior, error: priorError } = await supabase
    .from("attendance_overrides")
    .select("makeup_date")
    .eq("student_id", studentId)
    .eq("date", date)
    .eq("status", "absent")
    .maybeSingle();
  if (priorError) throw priorError;

  const { error } = await supabase
    .from("attendance_overrides")
    .update(
      makeupRequired
        ? { makeup_required: true }
        : { makeup_required: false, makeup_date: null, makeup_time: null }
    )
    .eq("student_id", studentId)
    .eq("date", date)
    .eq("status", "absent");

  if (error) throw error;

  const affectedDates = [date, prior?.makeup_date ?? null].filter((d): d is string => d != null);
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

// Forces a day to true "no record" state by deleting its actual check-in
// record(s) as well as any admin override. Clearing just the override (as
// clearAttendanceOverride does) leaves a real check-in behind, so the day's
// status would keep reading back as "present" — this is for when the admin
// has explicitly confirmed they want that check-in gone too.
export async function clearAttendanceDayRecords(
  studentId: string,
  date: string
): Promise<Record<string, DayAttendanceInfo>> {
  if (!DATE_RE.test(date)) throw new Error("Invalid date");

  const { year, month, day } = parseDateStr(date);
  const dayStart = kstMidnightIso(year, month, day);
  const dayEnd = kstMidnightIso(year, month, day + 1);

  const supabase = getSupabaseServerClient();

  const [{ error: recordsError }, { data: deletedOverride, error: overrideError }] = await Promise.all([
    supabase
      .from("attendance_records")
      .delete()
      .eq("student_id", studentId)
      .gte("check_in_at", dayStart)
      .lt("check_in_at", dayEnd),
    supabase
      .from("attendance_overrides")
      .delete()
      .eq("student_id", studentId)
      .eq("date", date)
      .select("makeup_date")
      .maybeSingle(),
  ]);

  if (recordsError) throw recordsError;
  if (overrideError) throw overrideError;

  const affectedDates = [date, deletedOverride?.makeup_date ?? null].filter((d): d is string => d != null);
  return getDatesAttendanceInfo(studentId, affectedDates);
}
