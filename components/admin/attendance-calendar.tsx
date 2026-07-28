"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@/components/icons";
import { TimeSelect } from "@/components/admin/time-select";
import { ConfirmModal } from "@/components/admin/confirm-modal";
import {
  clearAttendanceDayAction,
  getStudentAttendanceMonthAction,
  setAttendanceMakeupDateAction,
  setAttendanceStatusAction,
} from "@/app/admin/actions";
import type { AdminStudentSummary } from "@/lib/students";
import type { DayAttendanceInfo, DayAttendanceStatus } from "@/lib/attendance-calendar";
import { dayKeyForDateStr, TIME_RE, type DayKey } from "@/lib/schedule";
import { formatTime } from "@/lib/format";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const STATUS_OPTIONS: { value: DayAttendanceStatus; label: string; activeClassName: string }[] = [
  { value: "present", label: "출석", activeClassName: "bg-emerald-500 text-white" },
  { value: "absent", label: "결석", activeClassName: "bg-rose-500 text-white" },
  { value: "none", label: "기록없음", activeClassName: "bg-navy-900 text-cream-50" },
];

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

function emptyDayInfo(): DayAttendanceInfo {
  return {
    status: "none",
    checkInAt: null,
    checkOutAt: null,
    makeupDate: null,
    makeupTime: null,
    makeupForDates: [],
    makeupCompleted: false,
    targetFulfilled: false,
    classDaysSnapshot: null,
  };
}

function formatMonthDayLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

function formatShortMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// The shared formatTime() spells out 오전/오후, which overflows the narrow
// calendar cells. Cells need a 24h HH:MM instead; the detail overlay still
// uses formatTime() for its more spacious layout.
function formatShortTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// True when the date falls on one of the student's regular weekly class
// days, so a scheduled makeup there would overlap with an already-planned
// regular session rather than being an extra, dedicated visit.
function isRegularClassDay(dateStr: string, classDays: DayKey[]): boolean {
  const key = dayKeyForDateStr(dateStr);
  return key != null && classDays.includes(key);
}

type Props = {
  student: AdminStudentSummary;
};

export function AttendanceCalendar({ student }: Props) {
  const today = todayKst();
  const todayStr = ymd(today.year, today.month, today.day);
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [data, setData] = useState<Record<string, DayAttendanceInfo>>({});
  const [loadError, setLoadError] = useState(false);
  const [loading, startLoadingTransition] = useTransition();
  const [savingDates, setSavingDates] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [clearWarningDate, setClearWarningDate] = useState<string | null>(null);
  const [clearWarningPending, setClearWarningPending] = useState(false);

  const fetchMonth = (studentId: string, y: number, m: number) => {
    startLoadingTransition(async () => {
      try {
        const result = await getStudentAttendanceMonthAction(studentId, y, m);
        setData(result);
        setLoadError(false);
      } catch (error) {
        console.error("Failed to load attendance calendar", error);
        setLoadError(true);
      }
    });
  };

  useEffect(() => {
    fetchMonth(student.id, year, month);
  }, [student.id, year, month]);

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

  // A "정규" (regular class day) warning only makes sense against the
  // schedule actually in force on that date. For a date that's already
  // happened, that's the class_days_snapshot recorded when the override was
  // last saved — the schedule can have changed since, but the snapshot is
  // what created whatever ambiguity is in that day's attendance record. For
  // a date that hasn't happened yet, the snapshot may be stale (the
  // student's regular days can still change before it arrives), so use the
  // live, current schedule instead.
  const classDaysAsOf = (dateStr: string, snapshot: DayKey[] | null): DayKey[] =>
    dateStr < todayStr ? (snapshot ?? student.classDays) : student.classDays;

  const withSaving = async (dateStr: string, task: () => Promise<Record<string, DayAttendanceInfo>>) => {
    setSavingDates((prev) => new Set(prev).add(dateStr));
    try {
      const updates = await task();
      setData((prev) => ({ ...prev, ...updates }));
    } catch (error) {
      console.error("Failed to save attendance override", error);
      // Unknown whether the write landed, so fall back to a full refetch to
      // recover a consistent view. The happy path above skips this refetch.
      fetchMonth(student.id, year, month);
    } finally {
      setSavingDates((prev) => {
        const next = new Set(prev);
        next.delete(dateStr);
        return next;
      });
    }
  };

  const handleStatusChange = (dateStr: string, status: DayAttendanceStatus) => {
    // A real check-in record on this day would keep re-deriving "present"
    // even after the override is cleared, so clearing the override alone
    // can't produce "기록없음" here — the check-in itself has to go, which
    // needs the admin's explicit confirmation first.
    if (status === "none" && data[dateStr]?.checkInAt != null) {
      setClearWarningDate(dateStr);
      return;
    }

    setData((prev) => {
      const entry = prev[dateStr] ?? emptyDayInfo();
      return {
        ...prev,
        [dateStr]: { ...entry, status, makeupDate: status === "absent" ? entry.makeupDate : null },
      };
    });

    const action: "present" | "absent" | "auto" = status === "none" ? "auto" : status;
    void withSaving(dateStr, () => setAttendanceStatusAction(student.id, dateStr, action));
  };

  const confirmClearAttendanceDay = async () => {
    const dateStr = clearWarningDate;
    if (!dateStr) return;
    setClearWarningPending(true);
    try {
      await withSaving(dateStr, () => clearAttendanceDayAction(student.id, dateStr));
      setClearWarningDate(null);
    } finally {
      setClearWarningPending(false);
    }
  };

  const handleMakeupChange = (dateStr: string, makeupDate: string | null, makeupTime: string | null) => {
    const resolvedTime = makeupDate === null ? null : makeupTime;

    setData((prev) => {
      const entry = prev[dateStr];
      if (!entry) return prev;
      // makeupCompleted reflected the OLD makeup date's status — it doesn't
      // carry over to a newly picked date, which hasn't happened yet.
      return { ...prev, [dateStr]: { ...entry, makeupDate, makeupTime: resolvedTime, makeupCompleted: false } };
    });

    if (makeupDate !== null && (resolvedTime === null || !TIME_RE.test(resolvedTime))) return;

    void withSaving(dateStr, () => setAttendanceMakeupDateAction(student.id, dateStr, makeupDate, resolvedTime));
  };

  const totalDays = daysInMonth(year, month);
  const leadingBlanks = firstWeekday(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  // A date selected before navigating to a different month shouldn't stay
  // "selected" once it's no longer visible in the grid.
  const visibleSelectedDate =
    selectedDate && selectedDate.startsWith(`${year}-${pad2(month)}-`) ? selectedDate : null;
  const selectedInfo = visibleSelectedDate ? (data[visibleSelectedDate] ?? emptyDayInfo()) : null;
  const selectedSaving = visibleSelectedDate != null && savingDates.has(visibleSelectedDate);

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
          출석 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.
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
              const info = data[dateStr] ?? emptyDayInfo();
              const isToday = year === today.year && month === today.month && day === today.day;
              const saving = savingDates.has(dateStr);
              const isClassDay = isRegularClassDay(dateStr, student.classDays);
              const isPaymentDay = student.paymentDay === day;

              const makeupLine =
                info.status === "absent" && info.makeupDate
                  ? { text: `보강 ${formatShortMonthDay(info.makeupDate)}`, done: info.makeupCompleted }
                  : info.makeupForDates.length > 0
                    ? {
                        text: `${info.targetFulfilled ? "보강완료" : "보강예정"}${
                          info.makeupForDates.length > 1 ? ` ×${info.makeupForDates.length}` : ""
                        }${isRegularClassDay(dateStr, classDaysAsOf(dateStr, info.classDaysSnapshot)) ? " · 정규" : ""}`,
                        done: info.targetFulfilled,
                      }
                    : null;

              const statusClassName =
                info.status === "present"
                  ? "border-emerald-200 bg-emerald-50"
                  : info.status === "absent"
                    ? "border-rose-200 bg-rose-50"
                    : "border-navy-900/10 bg-white";

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  aria-label={`${month}월 ${day}일 선택`}
                  className={`relative flex min-h-[96px] flex-col items-start gap-0.5 rounded-lg border p-1 text-left text-[10px] leading-tight transition-colors hover:brightness-95 sm:min-h-[130px] sm:gap-1 sm:rounded-xl sm:p-2 sm:text-xs ${statusClassName} ${
                    isToday ? "ring-2 ring-gold-500 ring-offset-1" : ""
                  } ${saving ? "opacity-50" : ""}`}
                >
                  {isPaymentDay && (
                    <span
                      className="absolute right-0.5 top-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-rose-500 text-[6px] font-bold text-white shadow-sm sm:h-3.5 sm:w-3.5 sm:text-[8px]"
                      title="결제일"
                    >
                      ₩
                    </span>
                  )}

                  <span
                    className={`${isClassDay ? "font-extrabold underline decoration-2 underline-offset-2" : "font-semibold"} ${
                      isToday ? "text-gold-600" : "text-navy-900"
                    }`}
                  >
                    {day}
                  </span>

                  {info.checkInAt != null && (
                    <span className="w-full text-navy-900/50">등 {formatShortTime(info.checkInAt)}</span>
                  )}
                  {info.checkOutAt != null && (
                    <span className="w-full text-navy-900/50">하 {formatShortTime(info.checkOutAt)}</span>
                  )}

                  {makeupLine && (
                    <span className={`w-full font-medium ${makeupLine.done ? "text-emerald-600" : "text-amber-600"}`}>
                      {makeupLine.text}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

      {visibleSelectedDate && selectedInfo && (
        <div className="relative flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-[0_15px_40px_-30px_rgba(10,23,48,0.3)] sm:p-6">
          <button
            type="button"
            onClick={() => setSelectedDate(null)}
            aria-label="닫기"
            className="absolute right-4 top-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-navy-900/40 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
          >
            <XIcon className="h-4 w-4" />
          </button>

          <div className="flex items-center justify-between pr-8">
            <span className="text-sm font-bold text-navy-900">{formatMonthDayLabel(visibleSelectedDate)}</span>
            {(selectedInfo.checkInAt != null || selectedInfo.checkOutAt != null) && (
              <span className="text-xs text-navy-900/50">
                {selectedInfo.checkInAt != null && <>등원 {formatTime(selectedInfo.checkInAt)} </>}
                {selectedInfo.checkOutAt != null && <>하원 {formatTime(selectedInfo.checkOutAt)}</>}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={selectedSaving}
                onClick={() => handleStatusChange(visibleSelectedDate, opt.value)}
                className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selectedInfo.status === opt.value
                    ? opt.activeClassName
                    : "bg-white text-navy-900/60 hover:bg-navy-900/5"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {selectedInfo.status === "absent" && (
            <label className="flex flex-col gap-1.5 text-xs font-medium text-navy-900/50">
              보강 날짜/시간
              <div className="flex gap-2">
                <input
                  type="date"
                  value={selectedInfo.makeupDate ?? ""}
                  disabled={selectedSaving}
                  onChange={(e) => {
                    const value = e.target.value || null;
                    handleMakeupChange(visibleSelectedDate, value, selectedInfo.makeupTime);
                  }}
                  className="w-full max-w-[160px] rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-sm text-navy-900 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <TimeSelect
                  key={visibleSelectedDate}
                  defaultValue={selectedInfo.makeupTime ?? ""}
                  disabled={selectedSaving || !selectedInfo.makeupDate}
                  onChange={(next) => {
                    handleMakeupChange(visibleSelectedDate, selectedInfo.makeupDate, next || null);
                  }}
                />
              </div>
              {selectedInfo.makeupDate && (
                <span className={`font-normal ${selectedInfo.makeupCompleted ? "text-emerald-600" : "text-navy-900/50"}`}>
                  {formatMonthDayLabel(selectedInfo.makeupDate)}
                  {selectedInfo.makeupTime ? ` ${selectedInfo.makeupTime}` : ""}로{" "}
                  {selectedInfo.makeupCompleted ? "보강완료했어요" : "보강 예정이에요"}
                </span>
              )}
              {selectedInfo.makeupDate &&
                isRegularClassDay(
                  selectedInfo.makeupDate,
                  classDaysAsOf(selectedInfo.makeupDate, selectedInfo.classDaysSnapshot)
                ) && (
                <span className="font-normal text-amber-600">
                  ⚠ {formatMonthDayLabel(selectedInfo.makeupDate)}은 이미 정규 수업일이에요. 학생이 그날 그냥
                  평소처럼 등원한 것인지 보강을 위해 온 것인지 구분되지 않으니 참고해주세요.
                </span>
              )}
            </label>
          )}

          {selectedInfo.makeupForDates.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-navy-900/50">
                이 날은 아래 결석에 대한 보강일이에요 — {selectedInfo.targetFulfilled ? "보강완료" : "보강예정"}
              </p>
              <ul className="flex flex-col gap-0.5 text-xs text-navy-900/50">
                {selectedInfo.makeupForDates.map((m) => (
                  <li key={m.date}>
                    {formatMonthDayLabel(m.date)} 결석 → {m.time ?? "시간 미정"} 보강
                  </li>
                ))}
              </ul>
              {isRegularClassDay(visibleSelectedDate, classDaysAsOf(visibleSelectedDate, selectedInfo.classDaysSnapshot)) && (
                <p className="text-xs text-amber-600">
                  ⚠ 이 날은 정규 수업일이기도 해요. 체크인 기록만으로는 평소 등원과 보강을 구분할 수 없으니,
                  실제로 보강이 진행됐는지는 직접 확인해주세요.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={clearWarningDate !== null}
        title="등원 기록 삭제"
        message={
          clearWarningDate
            ? `${formatMonthDayLabel(clearWarningDate)}에 이미 등원 기록이 있어요. 기록없음으로 바꾸면 그 날의 등원/하원 기록이 모두 삭제되며 복구할 수 없어요. 계속할까요?`
            : ""
        }
        confirmLabel="삭제하고 변경"
        pending={clearWarningPending}
        onConfirm={confirmClearAttendanceDay}
        onClose={() => setClearWarningDate(null)}
      />
    </div>
  );
}
