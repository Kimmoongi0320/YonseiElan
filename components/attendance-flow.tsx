"use client";

import { useEffect, useState } from "react";
import { Modal } from "./modal";
import { Keypad } from "./keypad";
import { CheckCircleIcon, CheckInIcon, CheckOutIcon, ClockIcon, UserIcon } from "./icons";
import { formatRemainingMinutes, formatTime } from "@/lib/format";
import { CHECK_OUT_WAIT_MS } from "@/lib/constants";

type Mode = "in" | "out";
type Phase = "phone" | "loading" | "names" | "empty" | "confirm" | "success";
type StudentOption = { id: string; name: string };
type StatusInfo = { checkedIn: boolean; checkInAt: number | null };

const PHONE_LENGTH = 4;

const MODE_COPY: Record<Mode, { title: string; verb: string; accent: string; Icon: typeof CheckInIcon }> = {
  in: { title: "등원", verb: "등원하기", accent: "bg-navy-900 hover:bg-navy-800", Icon: CheckInIcon },
  out: { title: "하원", verb: "하원하기", accent: "bg-gold-500 hover:bg-gold-600 text-navy-950", Icon: CheckOutIcon },
};

export function AttendanceFlow() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [phase, setPhase] = useState<Phase>("phone");
  const [phone, setPhone] = useState("");
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selected, setSelected] = useState<StudentOption | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const open = (m: Mode) => {
    setMode(m);
    setPhase("phone");
    setPhone("");
    setStudents([]);
    setSelected(null);
    setStatus(null);
  };

  const close = () => setMode(null);

  useEffect(() => {
    if (phase !== "confirm" || mode !== "out" || !status?.checkedIn) return;
    const remaining = CHECK_OUT_WAIT_MS - (now - (status.checkInAt ?? now));
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [phase, mode, status, now]);

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

  const selectStudent = async (student: StudentOption) => {
    setSelected(student);
    setPhase("confirm");
    setStatusLoading(true);
    setNow(Date.now());
    try {
      const res = await fetch(`/api/attendance/status?studentId=${student.id}`);
      const data = await res.json();
      setStatus({ checkedIn: data.checkedIn, checkInAt: data.checkInAt ?? null });
    } catch {
      setStatus({ checkedIn: false, checkInAt: null });
    } finally {
      setStatusLoading(false);
    }
  };

  const submitCheckIn = async () => {
    if (!selected) return;
    setActionPending(true);
    try {
      const res = await fetch("/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selected.id }),
      });
      if (res.ok) {
        setSuccessMessage(`${selected.name}님, 등원이 확인되었습니다`);
        setPhase("success");
      } else {
        const data = await res.json();
        if (data.reason === "already-checked-in") {
          setStatus({ checkedIn: true, checkInAt: status?.checkInAt ?? Date.now() });
        }
      }
    } finally {
      setActionPending(false);
    }
  };

  const submitCheckOut = async () => {
    if (!selected) return;
    setActionPending(true);
    try {
      const res = await fetch("/api/attendance/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selected.id }),
      });
      if (res.ok) {
        setSuccessMessage(`${selected.name}님, 하원이 확인되었습니다`);
        setPhase("success");
      } else {
        const data = await res.json();
        if (data.reason === "too-early") {
          setStatus({ checkedIn: true, checkInAt: (status?.checkInAt ?? Date.now()) });
          setNow(Date.now());
        }
      }
    } finally {
      setActionPending(false);
    }
  };

  const copy = mode ? MODE_COPY[mode] : null;
  const remainingMs = status?.checkInAt ? CHECK_OUT_WAIT_MS - (now - status.checkInAt) : 0;

  return (
    <>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <button
          type="button"
          onClick={() => open("in")}
          className="group flex flex-col items-center justify-center gap-3 rounded-[2rem] bg-navy-900 px-8 py-8 text-cream-50 shadow-[0_20px_60px_-15px_rgba(15,36,71,0.45)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.02] active:scale-[0.98] sm:gap-4 sm:py-14"
        >
          <CheckInIcon className="h-10 w-10 text-gold-400 sm:h-12 sm:w-12" />
          <span className="text-2xl font-bold sm:text-3xl">등원</span>
        </button>

        <button
          type="button"
          onClick={() => open("out")}
          className="group flex flex-col items-center justify-center gap-3 rounded-[2rem] bg-gold-500 px-8 py-8 text-navy-950 shadow-[0_20px_60px_-15px_rgba(169,122,44,0.4)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.02] active:scale-[0.98] sm:gap-4 sm:py-14"
        >
          <CheckOutIcon className="h-10 w-10 text-navy-900 sm:h-12 sm:w-12" />
          <span className="text-2xl font-bold sm:text-3xl">하원</span>
        </button>
      </div>

      <Modal open={mode !== null} onClose={close}>
        {copy && phase === "phone" && (
          <div className="flex flex-col items-center gap-6">
            <h2 className="text-lg font-bold text-navy-900">{copy.title} - 부모님 전화번호 뒤 4자리</h2>
            <div className="flex items-center gap-4">
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
          <div className="flex flex-col items-center gap-3 py-10 text-navy-900/60">
            <p>조회 중...</p>
          </div>
        )}

        {copy && phase === "names" && (
          <div className="flex flex-col items-center gap-5">
            <h2 className="text-lg font-bold text-navy-900">학생을 선택해주세요</h2>
            <div className="flex w-full flex-col gap-3">
              {students.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectStudent(s)}
                  className="flex items-center gap-3 rounded-2xl border border-navy-900/10 bg-navy-50 px-5 py-4 text-left transition-colors hover:bg-navy-100 active:scale-[0.98]"
                >
                  <UserIcon className="h-6 w-6 text-navy-700" />
                  <span className="text-lg font-semibold text-navy-900">{s.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPhase("phone")}
              className="text-sm text-navy-900/50 hover:text-navy-900"
            >
              다시 입력
            </button>
          </div>
        )}

        {phase === "empty" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <UserIcon className="h-10 w-10 text-navy-900/30" />
            <h2 className="text-lg font-bold text-navy-900">일치하는 학생이 없습니다</h2>
            <p className="text-sm text-navy-900/50">전화번호를 다시 확인해주세요</p>
            <button
              type="button"
              onClick={() => setPhase("phone")}
              className="mt-2 rounded-full bg-navy-900/5 px-5 py-2.5 text-sm font-medium text-navy-900 hover:bg-navy-900/10"
            >
              다시 입력
            </button>
          </div>
        )}

        {copy && selected && phase === "confirm" && (
          <div className="flex flex-col items-center gap-5 text-center">
            <copy.Icon className="h-10 w-10 text-navy-800" />
            <h2 className="text-xl font-bold text-navy-900">{selected.name}님</h2>

            {statusLoading ? (
              <p className="text-sm text-navy-900/50">확인 중...</p>
            ) : mode === "in" ? (
              status?.checkedIn ? (
                <p className="text-sm text-navy-900/60">이미 등원 처리된 학생입니다</p>
              ) : (
                <button
                  type="button"
                  onClick={submitCheckIn}
                  disabled={actionPending}
                  className={`w-full rounded-2xl ${copy.accent} py-4 text-lg font-bold text-cream-50 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:opacity-60`}
                >
                  {copy.verb}
                </button>
              )
            ) : !status?.checkedIn ? (
              <p className="text-sm text-navy-900/60">등원 기록이 없습니다. 먼저 등원해주세요.</p>
            ) : remainingMs > 0 ? (
              <>
                <p className="text-sm text-navy-900/50">
                  등원 시각 {status.checkInAt ? formatTime(status.checkInAt) : ""}
                </p>
                <div className="flex items-center gap-2 rounded-2xl bg-navy-900/5 px-4 py-3 text-sm text-navy-900/70">
                  <ClockIcon className="h-4 w-4 shrink-0" />
                  {selected.name}님은 등원 후 50분이 지나야 하원할 수 있어요. (남은 시간: {formatRemainingMinutes(remainingMs)}분)
                </div>
                <button
                  type="button"
                  disabled
                  className="w-full rounded-2xl bg-navy-900/10 py-4 text-lg font-bold text-navy-900/40"
                >
                  {copy.verb}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-navy-900/50">
                  등원 시각 {status.checkInAt ? formatTime(status.checkInAt) : ""}
                </p>
                <button
                  type="button"
                  onClick={submitCheckOut}
                  disabled={actionPending}
                  className={`w-full rounded-2xl ${copy.accent} py-4 text-lg font-bold transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:opacity-60`}
                >
                  {copy.verb}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setPhase("names")}
              className="text-sm text-navy-900/50 hover:text-navy-900"
            >
              다시 선택
            </button>
          </div>
        )}

        {phase === "success" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center animate-fade-in-up">
            <CheckCircleIcon className="h-14 w-14 text-navy-900" />
            <p className="text-lg font-bold text-navy-900">{successMessage}</p>
            <button
              type="button"
              onClick={close}
              className="mt-2 rounded-full bg-navy-900/5 px-6 py-2.5 text-sm font-medium text-navy-900 hover:bg-navy-900/10"
            >
              확인
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
