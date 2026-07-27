// The academy only holds classes Monday through Saturday.
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isDayKey(value: string): value is DayKey {
  return (DAY_KEYS as readonly string[]).includes(value);
}

// KST has no DST, so a fixed UTC+9 shift is always correct.
// Returns null on Sundays, since there's no matching class-day filter.
export function getTodayDayKeyKst(nowMs: number = Date.now()): DayKey | null {
  const jsDay = new Date(nowMs + KST_OFFSET_MS).getUTCDay(); // 0 = Sun ... 6 = Sat
  if (jsDay === 0) return null;
  return DAY_KEYS[jsDay - 1];
}

export function sortDayKeys(days: DayKey[]): DayKey[] {
  return DAY_KEYS.filter((d) => days.includes(d));
}

// Per-day class time, keyed by DayKey ("HH:MM" 24h strings). Only days present
// in a student's class_days are expected to have an entry.
export type ClassTimes = Partial<Record<DayKey, string>>;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeString(value: string): boolean {
  return TIME_RE.test(value);
}

// JS getUTCDay() index (0=Sun..6=Sat) -> DayKey. Sunday has no DayKey since
// the academy holds no Sunday classes.
const JS_DAY_TO_DAYKEY: (DayKey | null)[] = [null, "mon", "tue", "wed", "thu", "fri", "sat"];

// Resolves a "YYYY-MM-DD" calendar date string to the DayKey it falls on.
// Parsed as a plain calendar date (via Date.UTC) rather than a KST instant,
// since the string is already a KST calendar date with no time component.
export function dayKeyForDateStr(dateStr: string): DayKey | null {
  const [year, month, day] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return JS_DAY_TO_DAYKEY[jsDay];
}
