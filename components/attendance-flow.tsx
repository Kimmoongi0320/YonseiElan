"use client";

import { useEffect, useRef, useState } from "react";
import { Keypad } from "./keypad";
import { CheckCircleIcon, ClockIcon, UserIcon, XIcon } from "./icons";
import { formatRemainingMinutes } from "@/lib/format";
import { DAY_LABELS, type DayKey } from "@/lib/schedule";

type Phase = "phone" | "loading" | "names" | "empty" | "resolving" | "info";
type StudentOption = { id: string; name: string; age: number | null; classDays: DayKey[] };
type AttendanceAction = "check-in" | "check-out";
type InfoContent = { title: string; message: string };
type ToastState = {
  key: number;
  studentName: string;
  action: AttendanceAction;
  recordId: string;
  studentId: string;
};
type ResolveFailure =
  | { ok: false; reason: "already-completed" }
  | { ok: false; reason: "too-early"; remainingMs: number }
  | { ok: false; reason: "after-hours"; message?: string }
  | { ok: false; reason: "already-checked-in"; message?: string }
  | { ok: false; reason: "not-checked-in" }
  | { ok: false; reason: "not-found" };

const PHONE_LENGTH = 4;
const TOAST_DURATION_MS = 4500;

const ACTION_VERB: Record<AttendanceAction, string> = {
  "check-in": "등원",
  "check-out": "하원",
};

function describeFailure(studentName: string, data: ResolveFailure): InfoContent {
  const title = `${studentName}님`;
  switch (data.reason) {
    case "already-completed":
      return { title, message: "오늘 등원과 하원을 모두 마쳤어요" };
    case "too-early":
      return {
        title,
        message: `등원 후 50분이 지나야 하원할 수 있어요. (남은 시간: ${formatRemainingMinutes(data.remainingMs)}분)`,
      };
    case "after-hours":
      return { title, message: data.message ?? "운영 시간이 종료되어 등원 처리가 불가능합니다" };
    case "already-checked-in":
      return { title, message: "이미 등원 처리된 학생입니다" };
    case "not-checked-in":
      return { title, message: "등원 기록이 없습니다. 먼저 등원해주세요" };
    default:
      return { title: "오류가 발생했습니다", message: "잠시 후 다시 시도해주세요" };
  }
}

export function AttendanceFlow() {
  const [phase, setPhase] = useState<Phase>("phone");
  const [phone, setPhone] = useState("");
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [info, setInfo] = useState<InfoContent | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastKeyRef = useRef(0);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const resetToPhone = () => {
    setPhase("phone");
    setPhone("");
    setStudents([]);
    setInfo(null);
  };

  const handleDigit = (d: string) => {
    if (phone.length >= PHONE_LENGTH) return;
    setPhone((prev) => prev + d);
  };

  const handleBackspace = () => setPhone((prev) => prev.slice(0, -1));

  const lookupPhone = async () => {
    setPhase("loading");
    try {
      const res = await fetch("/api/students/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      const found: StudentOption[] = data.students ?? [];
      setStudents(found);
      setPhase(found.length > 0 ? "names" : "empty");
    } catch {
      setStudents([]);
      setPhase("empty");
    }
  };

  // Non-blocking: fires while the screen is already back on the phone pad,
  // so the next student in line can start typing immediately.
  const showToast = (next: ToastState) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  };

  // Tapping a name is the confirmation — no separate 등원하기/하원하기 button.
  // The server decides which action applies from today's attendance state.
  const selectStudent = async (student: StudentOption) => {
    setPhase("resolving");
    try {
      const res = await fetch("/api/attendance/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        resetToPhone();
        toastKeyRef.current += 1;
        showToast({
          key: toastKeyRef.current,
          studentName: student.name,
          action: data.action,
          recordId: data.record.id,
          studentId: student.id,
        });
        return;
      }

      setInfo(describeFailure(student.name, data as ResolveFailure));
      setPhase("info");
    } catch {
      setInfo({ title: "오류가 발생했습니다", message: "잠시 후 다시 시도해주세요" });
      setPhase("info");
    }
  };

  const dismissToast = () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  };

  const undoToast = async () => {
    if (!toast) return;
    const { recordId, studentId, action } = toast;
    dismissToast();
    try {
      await fetch("/api/attendance/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, studentId, action }),
      });
    } catch {
      // Best-effort — an admin can still correct the record from the dashboard.
    }
  };

  return (
    <>
      <div
        className="relative flex w-full max-w-sm flex-col items-center rounded-[2rem] bg-white p-6 shadow-[0_20px_60px_-15px_rgba(15,36,71,0.25)] animate-fade-in-up sm:p-8"
        style={{ animationDelay: "100ms" }}
      >
        {phase === "phone" && (
          <div className="flex flex-col items-center space-y-6">
            <h2 className="text-lg font-bold text-navy-900">부모님 전화번호 뒤 4자리</h2>
            <div className="flex items-center space-x-4">
              {Array.from({ length: PHONE_LENGTH }).map((_, i) => (
                <span
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full border-2 ${
                    i < phone.length ? "border-navy-900 bg-navy-900" : "border-navy-900/20"
                  }`}
                />
              ))}
            </div>
            <Keypad
              onDigit={handleDigit}
              onBackspace={handleBackspace}
              confirm={{ label: "확인", onConfirm: lookupPhone, disabled: phone.length !== PHONE_LENGTH }}
            />
          </div>
        )}

        {phase === "loading" && (
          <div className="flex flex-col items-center space-y-3 py-10 text-navy-900/60">
            <p>조회 중...</p>
          </div>
        )}

        {phase === "names" && (
          <div className="flex w-full flex-col items-center space-y-5">
            <h2 className="text-lg font-bold text-navy-900">학생을 선택해주세요</h2>
            <div className="flex w-full flex-col space-y-3">
              {students.map((s) => {
                const details = [
                  s.age != null ? `${s.age}세` : null,
                  s.classDays.length > 0 ? s.classDays.map((d) => DAY_LABELS[d]).join("·") : null,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectStudent(s)}
                    className="flex items-center space-x-4 rounded-2xl border border-navy-900/10 bg-navy-50 px-5 py-4 text-left transition-colors hover:bg-navy-100 active:scale-[0.98]"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy-900/10">
                      <UserIcon className="h-5 w-5 text-navy-700" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-lg font-semibold text-navy-900">{s.name}</span>
                      {details && <span className="text-sm text-navy-900/50">{details}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={resetToPhone} className="text-sm text-navy-900/50 hover:text-navy-900">
              다시 입력
            </button>
          </div>
        )}

        {phase === "empty" && (
          <div className="flex flex-col items-center space-y-4 py-4 text-center">
            <UserIcon className="h-10 w-10 text-navy-900/30" />
            <h2 className="text-lg font-bold text-navy-900">일치하는 학생이 없습니다</h2>
            <p className="text-sm text-navy-900/50">전화번호를 다시 확인해주세요</p>
            <button
              type="button"
              onClick={resetToPhone}
              className="mt-2 rounded-full bg-navy-900/5 px-5 py-2.5 text-sm font-medium text-navy-900 hover:bg-navy-900/10"
            >
              다시 입력
            </button>
          </div>
        )}

        {phase === "resolving" && (
          <div className="flex flex-col items-center space-y-3 py-10 text-navy-900/60">
            <p>처리 중...</p>
          </div>
        )}

        {phase === "info" && info && (
          <div className="flex flex-col items-center space-y-4 py-4 text-center">
            <ClockIcon className="h-10 w-10 text-navy-900/30" />
            <h2 className="text-lg font-bold text-navy-900">{info.title}</h2>
            <p className="text-sm text-navy-900/50">{info.message}</p>
            <button
              type="button"
              onClick={resetToPhone}
              className="mt-2 rounded-full bg-navy-900/5 px-5 py-2.5 text-sm font-medium text-navy-900 hover:bg-navy-900/10"
            >
              다시 입력
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed inset-x-4 top-4 z-50 flex justify-center sm:inset-x-0">
          <div
            key={toast.key}
            className="flex w-full max-w-sm animate-fade-in-up items-center space-x-3 rounded-2xl bg-navy-900 px-4 py-3.5 text-cream-50 shadow-[0_20px_60px_-15px_rgba(15,36,71,0.5)]"
          >
            <CheckCircleIcon className="h-6 w-6 shrink-0 animate-pop text-gold-400" />
            <p className="flex-1 text-sm font-semibold">
              {toast.studentName}님, {ACTION_VERB[toast.action]}이 확인되었습니다
            </p>
            <button
              type="button"
              onClick={undoToast}
              className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
            >
              취소
            </button>
            <button
              type="button"
              onClick={dismissToast}
              aria-label="닫기"
              className="shrink-0 text-cream-50/60 hover:text-cream-50"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
