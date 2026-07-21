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
