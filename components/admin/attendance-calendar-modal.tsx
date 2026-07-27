"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import {
  getStudentAttendanceMonthAction,
  setAttendanceMakeupDateAction,
  setAttendanceStatusAction,
} from "@/app/admin/actions";
import type { AdminStudent } from "@/lib/students";
import type { DayAttendanceInfo, DayAttendanceStatus } from "@/lib/attendance-calendar";
import type { DayKey } from "@/lib/schedule";
import { formatTime } from "@/lib/format";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// JS getUTCDay() index (0=Sun..6=Sat) -> this app's DayKey. Sunday has no
// DayKey since the academy holds no Sunday classes (see lib/schedule.ts).
const JS_DAY_TO_DAYKEY: (DayKey | null)[] = [null, "mon", "tue", "wed", "thu", "fri", "sat"];

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

function parseDateStr(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m, day: d };
}

// True when the date falls on one of the student's regular weekly class
// days, so a scheduled makeup there would overlap with an already-planned
// regular session rather than being an extra, dedicated visit.
function isRegularClassDay(dateStr: string, classDays: DayKey[]): boolean {
  const { year, month, day } = parseDateStr(dateStr);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const key = JS_DAY_TO_DAYKEY[jsDay];
  return key != null && classDays.includes(key);
}

type Props = {
  open: boolean;
  onClose: () => void;
  student: AdminStudent | null;
};

export function AttendanceCalendarModal({ open, onClose, student }: Props) {
  const today = todayKst();
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [data, setData] = useState<Record<string, DayAttendanceInfo>>({});
  const [loadError, setLoadError] = useState(false);
  const [loading, startLoadingTransition] = useTransition();
  const [savingDates, setSavingDates] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
    if (!open || !student) return;
    fetchMonth(student.id, year, month);
  }, [open, student, year, month]);

  if (!student) return null;

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

  const isFutureDay = (dateStr: string) => {
    const d = parseDateStr(dateStr);
    if (d.year !== today.year || d.month !== today.month) {
      return d.year > today.year || (d.year === today.year && d.month > today.month);
    }
    return d.day > today.day;
  };

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

  const handleMakeupDateChange = (dateStr: string, makeupDate: string | null) => {
    setData((prev) => {
      const entry = prev[dateStr];
      if (!entry) return prev;
      return { ...prev, [dateStr]: { ...entry, makeupDate } };
    });

    void withSaving(dateStr, () => setAttendanceMakeupDateAction(student.id, dateStr, makeupDate));
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
  const selectedFuture = visibleSelectedDate != null && isFutureDay(visibleSelectedDate);

  return (
    <Modal open={open} onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-navy-900">{student.name} 출석 달력</h2>
          {student.paymentDay != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
              <span
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white"
                aria-hidden="true"
              >
                ₩
              </span>
              결제일 매월 {student.paymentDay}일
            </span>
          )}
        </div>

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

        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-navy-900/35">
              {WEEKDAY_LABELS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>

            <div className={`mt-1.5 grid grid-cols-7 gap-1.5 transition-opacity ${loading ? "opacity-40" : ""}`}>
              {cells.map((day, i) => {
                if (day == null) return <span key={`blank-${i}`} aria-hidden="true" />;

                const dateStr = ymd(year, month, day);
                const info = data[dateStr] ?? emptyDayInfo();
                const isToday = year === today.year && month === today.month && day === today.day;
                const isSelected = selectedDate === dateStr;
                const saving = savingDates.has(dateStr);
                const isClassDay = isRegularClassDay(dateStr, student.classDays);
                const isPaymentDay = student.paymentDay === day;

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
                    aria-pressed={isSelected}
                    aria-label={`${month}월 ${day}일 선택`}
                    className={`relative flex min-h-[92px] flex-col gap-1 rounded-xl border p-1.5 text-left text-[11px] leading-tight transition-colors hover:brightness-95 ${statusClassName} ${
                      isSelected ? "ring-2 ring-navy-900" : isToday ? "ring-2 ring-gold-500 ring-offset-1" : ""
                    } ${saving ? "opacity-50" : ""}`}
                  >
                    {isPaymentDay && (
                      <span
                        className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white shadow-sm"
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

                    {(info.checkInAt != null || info.checkOutAt != null) && (
                      <div className="text-navy-900/50">
                        {info.checkInAt != null && <div>등원 {formatTime(info.checkInAt)}</div>}
                        {info.checkOutAt != null && <div>하원 {formatTime(info.checkOutAt)}</div>}
                      </div>
                    )}

                    {info.status === "absent" && info.makeupDate && (
                      <div
                        className={`rounded px-1 py-0.5 text-center text-[10px] font-medium ${
                          info.makeupCompleted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {formatMonthDayLabel(info.makeupDate)} {info.makeupCompleted ? "보강완료" : "보강"}
                        {isRegularClassDay(info.makeupDate, info.classDaysSnapshot ?? student.classDays) && " · 정규"}
                      </div>
                    )}

                    {info.makeupForDates.length > 0 && (
                      <div
                        className={`rounded px-1 py-0.5 text-center text-[10px] font-medium ${
                          info.targetFulfilled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {info.targetFulfilled ? "보강완료" : "보강예정"}
                        {info.makeupForDates.length > 1 && ` ×${info.makeupForDates.length}`}
                        {isRegularClassDay(dateStr, info.classDaysSnapshot ?? student.classDays) && " · 정규"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-navy-900/[0.03] p-4">
          {!visibleSelectedDate || !selectedInfo ? (
            <p className="py-2 text-center text-sm text-navy-900/40">
              날짜를 선택하면 출석 상태를 확인하고 수정할 수 있어요.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-navy-900">{formatMonthDayLabel(visibleSelectedDate)}</span>
                {(selectedInfo.checkInAt != null || selectedInfo.checkOutAt != null) && (
                  <span className="text-xs text-navy-900/50">
                    {selectedInfo.checkInAt != null && <>등원 {formatTime(selectedInfo.checkInAt)} </>}
                    {selectedInfo.checkOutAt != null && <>하원 {formatTime(selectedInfo.checkOutAt)}</>}
                  </span>
                )}
              </div>

              {selectedFuture && (
                <p className="text-xs text-navy-900/40">아직 지나지 않은 날짜예요. 결석과 보강 예약만 등록할 수 있어요.</p>
              )}

              <div className="flex gap-2">
                {(selectedFuture ? STATUS_OPTIONS.filter((opt) => opt.value !== "present") : STATUS_OPTIONS).map(
                  (opt) => (
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
                  ),
                )}
              </div>

              {selectedInfo.status === "absent" && (
                <label className="flex flex-col gap-1.5 text-xs font-medium text-navy-900/50">
                  보강 날짜
                  <input
                    type="date"
                    min={visibleSelectedDate}
                    value={selectedInfo.makeupDate ?? ""}
                    disabled={selectedSaving}
                    onChange={(e) => {
                      const value = e.target.value || null;
                      if (value && value < visibleSelectedDate) return;
                      handleMakeupDateChange(visibleSelectedDate, value);
                    }}
                    className="w-full max-w-[200px] rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-sm text-navy-900 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {selectedInfo.makeupDate && (
                    <span className={`font-normal ${selectedInfo.makeupCompleted ? "text-emerald-600" : "text-navy-900/50"}`}>
                      {formatMonthDayLabel(selectedInfo.makeupDate)}로{" "}
                      {selectedInfo.makeupCompleted ? "보강완료했어요" : "보강 예정이에요"}
                    </span>
                  )}
                  {selectedInfo.makeupDate &&
                    isRegularClassDay(
                      selectedInfo.makeupDate,
                      selectedInfo.classDaysSnapshot ?? student.classDays
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
                    {selectedInfo.makeupForDates.map(formatMonthDayLabel).join(", ")} 결석에 대한 보강일이에요 —{" "}
                    {selectedInfo.targetFulfilled ? "보강완료" : "보강예정"}
                  </p>
                  {isRegularClassDay(visibleSelectedDate, selectedInfo.classDaysSnapshot ?? student.classDays) && (
                    <p className="text-xs text-amber-600">
                      ⚠ 이 날은 정규 수업일이기도 해요. 체크인 기록만으로는 평소 등원과 보강을 구분할 수 없으니,
                      실제로 보강이 진행됐는지는 직접 확인해주세요.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
