"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@/components/icons";
import { Modal } from "@/components/modal";
import { getScheduleMonthOverridesAction } from "@/app/admin/actions";
import type { MonthOverrideRow } from "@/lib/schedule-calendar";
import type { ScheduleStudent } from "@/lib/students";
import { dayKeyForDateStr } from "@/lib/schedule";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type Entry = {
  studentId: string;
  name: string;
  time: string | null;
  kind: "regular" | "makeup";
  isAbsent: boolean;
  originDate: string | null;
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

function todayKst(): { year: number; month: number; day: number } {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function formatMonthDayLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// Lessons are always 50 minutes — this is a display-only computation, not a
// stored value.
const CLASS_DURATION_MIN = 50;

function formatTimeRange(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const endTotalMin = h * 60 + m + CLASS_DURATION_MIN;
  const endH = Math.floor(endTotalMin / 60) % 24;
  const endM = endTotalMin % 60;
  return `${time}–${pad2(endH)}:${pad2(endM)}`;
}

function sortByTime(a: Entry, b: Entry): number {
  return (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
}

// Pixel height of one hour row in the day-timetable grid.
const HOUR_HEIGHT = 64;
// Fallback hour range when a day has no timed entries at all (e.g. an empty
// day, or one where every entry is still missing a time).
const DEFAULT_START_HOUR = 14;
const DEFAULT_END_HOUR = 21;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// At most this many overlapping entries are shown side by side in one row;
// beyond that they're rolled up into a single "+N명" overflow block instead
// of squeezing more (and more unreadable) columns into the same width.
const MAX_VISIBLE_COLUMNS = 3;

type PositionedEntry = Entry & { top: number; left: number; width: number };

type OverflowBlock = {
  top: number;
  height: number;
  left: number;
  width: number;
  entries: Entry[];
};

type DayTimetable = {
  startHour: number;
  endHour: number;
  positioned: PositionedEntry[];
  overflow: OverflowBlock[];
  untimed: Entry[];
};

// Lays entries with a time out on an hourly grid, like a calendar day view:
// each entry gets a fixed CLASS_DURATION_MIN-tall block positioned at its start time.
// Entries that overlap (same or overlapping hour) are split into side-by-side
// columns via standard interval partitioning, rather than stacking on top of
// each other, up to MAX_VISIBLE_COLUMNS — any further entries in the same
// overlapping cluster are merged into one overflow block. Entries with no
// time can't be placed on the grid and are returned separately.
function buildDayTimetable(entries: Entry[]): DayTimetable {
  const timed = entries.filter((e): e is Entry & { time: string } => e.time != null);
  const untimed = entries.filter((e) => e.time == null);

  const starts = timed.map((e) => timeToMinutes(e.time));
  const rawStartHour = starts.length ? Math.floor(Math.min(...starts) / 60) : DEFAULT_START_HOUR;
  const rawEndHour = starts.length ? Math.ceil((Math.max(...starts) + CLASS_DURATION_MIN) / 60) : DEFAULT_END_HOUR;
  const startHour = Math.max(0, rawStartHour - 1);
  const endHour = Math.min(24, rawEndHour + 1);

  const sorted = [...timed].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const positioned: PositionedEntry[] = [];
  const overflow: OverflowBlock[] = [];
  let i = 0;
  while (i < sorted.length) {
    let clusterEnd = i + 1;
    let clusterMaxEnd = timeToMinutes(sorted[i].time) + CLASS_DURATION_MIN;
    while (clusterEnd < sorted.length && timeToMinutes(sorted[clusterEnd].time) < clusterMaxEnd) {
      clusterMaxEnd = Math.max(clusterMaxEnd, timeToMinutes(sorted[clusterEnd].time) + CLASS_DURATION_MIN);
      clusterEnd++;
    }
    const cluster = sorted.slice(i, clusterEnd);

    // Greedy interval partitioning: place each entry in the first column
    // whose last-placed entry has already ended by this entry's start.
    const columnEnds: number[] = [];
    const columnByIndex: number[] = [];
    for (const entry of cluster) {
      const entryStart = timeToMinutes(entry.time);
      const entryEnd = entryStart + CLASS_DURATION_MIN;
      const col = columnEnds.findIndex((end) => end <= entryStart);
      if (col === -1) {
        columnByIndex.push(columnEnds.length);
        columnEnds.push(entryEnd);
      } else {
        columnByIndex.push(col);
        columnEnds[col] = entryEnd;
      }
    }
    const columnCount = columnEnds.length;
    const hasOverflow = columnCount > MAX_VISIBLE_COLUMNS;
    const totalColumns = hasOverflow ? MAX_VISIBLE_COLUMNS + 1 : columnCount;

    const overflowEntries: Entry[] = [];
    cluster.forEach((entry, idx) => {
      const col = columnByIndex[idx];
      if (hasOverflow && col >= MAX_VISIBLE_COLUMNS) {
        overflowEntries.push(entry);
        return;
      }
      const entryStart = timeToMinutes(entry.time);
      positioned.push({
        ...entry,
        top: ((entryStart - startHour * 60) / 60) * HOUR_HEIGHT,
        left: (col / totalColumns) * 100,
        width: (1 / totalColumns) * 100,
      });
    });

    if (overflowEntries.length > 0) {
      const overflowStarts = overflowEntries.map((e) => timeToMinutes(e.time as string));
      const minStart = Math.min(...overflowStarts);
      const maxEnd = Math.max(...overflowStarts) + CLASS_DURATION_MIN;
      overflow.push({
        top: ((minStart - startHour * 60) / 60) * HOUR_HEIGHT,
        height: ((maxEnd - minStart) / 60) * HOUR_HEIGHT,
        left: (MAX_VISIBLE_COLUMNS / totalColumns) * 100,
        width: (1 / totalColumns) * 100,
        entries: overflowEntries,
      });
    }

    i = clusterEnd;
  }

  return { startHour, endHour, positioned, overflow, untimed };
}

type Props = {
  students: ScheduleStudent[];
};

export function ScheduleCalendar({ students }: Props) {
  const today = todayKst();
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [overrides, setOverrides] = useState<MonthOverrideRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, startLoadingTransition] = useTransition();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Tapped block's entries, shown in a detail panel below the grid — this
  // screen is used on mobile, so details can't rely on mouse hover/title
  // tooltips (a single entry, or the whole group for a "+N명" overflow tap).
  const [detailEntries, setDetailEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    startLoadingTransition(async () => {
      try {
        const result = await getScheduleMonthOverridesAction(year, month);
        setOverrides(result);
        setLoadError(false);
      } catch (error) {
        console.error("Failed to load schedule overrides", error);
        setLoadError(true);
      }
    });
  }, [year, month]);

  const nameById = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);

  const overrideByStudentAndDate = useMemo(() => {
    const map = new Map<string, MonthOverrideRow>();
    for (const o of overrides) map.set(`${o.studentId}|${o.date}`, o);
    return map;
  }, [overrides]);

  const makeupsByDate = useMemo(() => {
    const map = new Map<string, MonthOverrideRow[]>();
    for (const o of overrides) {
      if (o.status !== "absent" || !o.makeupDate) continue;
      const list = map.get(o.makeupDate) ?? [];
      list.push(o);
      map.set(o.makeupDate, list);
    }
    return map;
  }, [overrides]);

  const entriesForDate = (dateStr: string): Entry[] => {
    const weekday = dayKeyForDateStr(dateStr);
    const regular: Entry[] = weekday
      ? students
          .filter((s) => s.classDays.includes(weekday))
          .map((s) => ({
            studentId: s.id,
            name: s.name,
            time: s.classTimes[weekday] ?? null,
            kind: "regular" as const,
            isAbsent: overrideByStudentAndDate.get(`${s.id}|${dateStr}`)?.status === "absent",
            originDate: null,
          }))
      : [];

    const makeup: Entry[] = (makeupsByDate.get(dateStr) ?? []).map((o) => ({
      studentId: o.studentId,
      name: nameById.get(o.studentId) ?? "알 수 없음",
      time: o.makeupTime,
      kind: "makeup" as const,
      isAbsent: false,
      originDate: o.date,
    }));

    return [...regular, ...makeup].sort(sortByTime);
  };

  const changeMonth = (delta: number) => {
    let nextMonth = month + delta;
    let nextYear = year;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setYear(nextYear);
    setMonth(nextMonth);
  };

  const totalDays = daysInMonth(year, month);
  const leadingBlanks = firstWeekday(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  const selectedEntries = selectedDate ? entriesForDate(selectedDate) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => changeMonth(-1)}
          aria-label="이전 달"
          className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-navy-900">
          {year}년 {month}월
        </span>
        <button
          type="button"
          onClick={() => changeMonth(1)}
          aria-label="다음 달"
          className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      {loadError && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-center text-sm text-rose-600">
          일정 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </p>
      )}

      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-navy-900/35 sm:gap-2 sm:text-xs">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className={`mt-1 grid grid-cols-7 gap-1 transition-opacity sm:mt-2 sm:gap-2 ${loading ? "opacity-40" : ""}`}>
          {cells.map((day, i) => {
            if (day == null) return <span key={`blank-${i}`} aria-hidden="true" />;

            const dateStr = ymd(year, month, day);
            const entries = entriesForDate(dateStr);
            const isToday = year === today.year && month === today.month && day === today.day;
            const hasAbsence = entries.some((e) => e.isAbsent);

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => {
                  setSelectedDate(dateStr);
                  setDetailEntries(null);
                }}
                aria-label={`${month}월 ${day}일 타임테이블 보기`}
                className={`relative flex min-h-[96px] flex-col items-start gap-0.5 rounded-lg border border-navy-900/10 bg-white p-1 text-left text-[10px] leading-tight transition-colors hover:brightness-95 sm:min-h-[130px] sm:gap-1 sm:rounded-xl sm:p-2 sm:text-xs ${
                  isToday ? "ring-2 ring-gold-500 ring-offset-1" : ""
                }`}
              >
                {hasAbsence && (
                  <span
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500"
                    aria-hidden="true"
                    title="결석 있음"
                  />
                )}
                <span className={`font-semibold ${isToday ? "text-gold-600" : "text-navy-900"}`}>{day}</span>
                {entries.length > 0 && <span className="w-full text-navy-900/50">{entries.length}명</span>}
              </button>
            );
          })}
        </div>
      </div>

      <Modal
        open={selectedDate !== null}
        onClose={() => {
          setSelectedDate(null);
          setDetailEntries(null);
        }}
        maxWidthClassName="max-w-lg"
      >
        {selectedDate &&
          (() => {
            const timetable = buildDayTimetable(selectedEntries);
            const hourMarks = Array.from(
              { length: timetable.endHour - timetable.startHour + 1 },
              (_, i) => timetable.startHour + i
            );
            const totalHeight = (timetable.endHour - timetable.startHour) * HOUR_HEIGHT;

            return (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-bold text-navy-900">{formatMonthDayLabel(selectedDate)} 타임테이블</h2>

                {selectedEntries.length === 0 ? (
                  <p className="text-sm text-navy-900/40">이 날은 예정된 수업이 없어요.</p>
                ) : (
                  <>
                    <div className="flex">
                      <div className="relative w-11 shrink-0" style={{ height: totalHeight }}>
                        {hourMarks.map((h) => (
                          <span
                            key={h}
                            className="absolute right-2 -translate-y-1/2 text-[10px] text-navy-900/40"
                            style={{ top: (h - timetable.startHour) * HOUR_HEIGHT }}
                          >
                            {pad2(h)}:00
                          </span>
                        ))}
                      </div>
                      <div
                        className="relative flex-1 overflow-hidden rounded-xl border border-navy-900/10"
                        style={{ height: totalHeight }}
                      >
                        {hourMarks.map((h) => (
                          <div
                            key={h}
                            className="absolute inset-x-0 border-t border-navy-900/5"
                            style={{ top: (h - timetable.startHour) * HOUR_HEIGHT }}
                          />
                        ))}
                        {timetable.positioned.map((entry, i) => (
                          <button
                            key={`${entry.studentId}-${entry.kind}-${i}`}
                            type="button"
                            onClick={() => setDetailEntries([entry])}
                            className="absolute px-0.5"
                            style={{
                              top: entry.top,
                              height: (CLASS_DURATION_MIN / 60) * HOUR_HEIGHT,
                              left: `${entry.left}%`,
                              width: `${entry.width}%`,
                            }}
                          >
                            <div
                              className={`flex h-full flex-col justify-center gap-0.5 overflow-hidden rounded-lg border px-2 py-1 text-left text-[11px] leading-tight ${
                                entry.isAbsent
                                  ? "border-rose-200 bg-rose-50"
                                  : entry.kind === "makeup"
                                    ? "border-amber-200 bg-amber-50"
                                    : "border-navy-900/10 bg-white"
                              }`}
                            >
                              <span className="truncate font-semibold text-navy-900">{entry.name}</span>
                              <span className="truncate text-navy-900/50">
                                {entry.time}
                                {entry.isAbsent ? " · 결석" : entry.kind === "makeup" ? " · 보강" : ""}
                              </span>
                            </div>
                          </button>
                        ))}
                        {timetable.overflow.map((block, i) => (
                          <button
                            key={`overflow-${i}`}
                            type="button"
                            onClick={() => setDetailEntries(block.entries)}
                            className="absolute px-0.5"
                            style={{
                              top: block.top,
                              height: block.height,
                              left: `${block.left}%`,
                              width: `${block.width}%`,
                            }}
                          >
                            <div className="flex h-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border border-navy-900/10 bg-navy-900/5 px-2 py-1 text-[11px] font-semibold leading-tight text-navy-900/60">
                              +{block.entries.length}명
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {timetable.untimed.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-xs font-medium text-navy-900/40">시간 미정</p>
                        {timetable.untimed.map((entry, i) => (
                          <div
                            key={`${entry.studentId}-${entry.kind}-untimed-${i}`}
                            className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm ${
                              entry.isAbsent ? "border-rose-200 bg-rose-50" : "border-navy-900/10 bg-white"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="font-semibold text-navy-900">{entry.name}</span>
                              {entry.kind === "makeup" && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                  보강
                                </span>
                              )}
                              {entry.isAbsent && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-600">
                                  결석
                                </span>
                              )}
                            </span>
                            <span className="text-navy-900/40">시간 미정</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
      </Modal>

      {detailEntries && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="flex w-full max-w-lg flex-col gap-2 rounded-t-2xl border border-navy-900/10 bg-white p-4 shadow-[0_-15px_40px_-20px_rgba(10,23,48,0.35)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900/40">선택한 학생</span>
              <button
                type="button"
                onClick={() => setDetailEntries(null)}
                aria-label="닫기"
                className="flex h-7 w-7 items-center justify-center rounded-full text-navy-900/40 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
              {detailEntries.map((entry, i) => (
                <div
                  key={`${entry.studentId}-${entry.kind}-detail-${i}`}
                  className="flex items-center justify-between gap-2 rounded-xl bg-navy-50/60 px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-navy-900">{entry.name}</span>
                    {entry.kind === "makeup" && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        보강{entry.originDate ? ` (${formatMonthDayLabel(entry.originDate)} 결석)` : ""}
                      </span>
                    )}
                    {entry.isAbsent && (
                      <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-600">
                        결석
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-navy-900/50">
                    {entry.time ? formatTimeRange(entry.time) : "시간 미정"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
