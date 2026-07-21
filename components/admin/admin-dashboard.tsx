"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { adminCheckOutAction, deleteStudentAction } from "@/app/admin/actions";
import { StatusBadge } from "./status-badge";
import { StudentFormModal } from "./student-form-modal";
import { ConfirmModal } from "./confirm-modal";
import {
  ArchiveIcon,
  CheckOutIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import type { AdminStudent, AttendanceStatus } from "@/lib/students";
import { DAY_KEYS, DAY_LABELS, getTodayDayKeyKst, sortDayKeys, type DayKey } from "@/lib/schedule";

type StatusFilter = "all" | AttendanceStatus;
type DayFilter = "all" | DayKey;

type PendingConfirm = { type: "delete" | "checkout"; student: AdminStudent };

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "checked_in", label: "등원중" },
  { value: "checked_out", label: "하원완료" },
  { value: "not_arrived", label: "미등원" },
];

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function AdminDashboard({ students }: { students: AdminStudent[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [todayKey] = useState(() => getTodayDayKeyKst());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formModal, setFormModal] = useState<{
    open: boolean;
    student: AdminStudent | null;
    nonce: number;
  }>({ open: false, student: null, nonce: 0 });
  const [confirmTarget, setConfirmTarget] = useState<PendingConfirm | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (dayFilter !== "all" && !s.classDays.includes(dayFilter)) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [students, search, statusFilter, dayFilter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const someFilteredSelected = filtered.some((s) => selected.has(s.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
    }
  }, [someFilteredSelected, allFilteredSelected]);

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((s) => next.delete(s.id));
      } else {
        filtered.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = () => setFormModal((s) => ({ open: true, student: null, nonce: s.nonce + 1 }));
  const openEdit = (student: AdminStudent) =>
    setFormModal((s) => ({ open: true, student, nonce: s.nonce + 1 }));
  const closeForm = () => setFormModal((s) => ({ ...s, open: false }));

  const handleBulkWithdraw = () => {
    // TODO: implement bulk withdrawal for selected students (selected: Set<string>),
    // then clear the selection with setSelected(new Set()) once it succeeds.
  };

  const runConfirm = async () => {
    if (!confirmTarget) return;
    setConfirmPending(true);
    try {
      if (confirmTarget.type === "delete") {
        await deleteStudentAction(confirmTarget.student.id);
      } else {
        await adminCheckOutAction(confirmTarget.student.id);
      }
    } finally {
      setConfirmPending(false);
      setConfirmTarget(null);
    }
  };

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-900/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름으로 검색"
            className="w-full rounded-full border border-navy-900/10 bg-white py-2.5 pl-10 pr-4 text-sm text-navy-900 placeholder:text-navy-900/30 focus:outline-none focus:ring-2 focus:ring-navy-900/20"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={handleBulkWithdraw}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-gold-500 px-4 py-2.5 text-sm font-semibold text-navy-950 transition-colors hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            <ArchiveIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">전체 퇴원 처리{selected.size > 0 ? ` (${selected.size})` : ""}</span>
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-navy-900 px-4 py-2.5 text-sm font-semibold text-cream-50 transition-colors hover:bg-navy-800 sm:flex-none"
          >
            <PlusIcon className="h-4 w-4 shrink-0" />
            학생 등록
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-white/60 p-4 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pr-1 text-xs font-semibold text-navy-900/35">상태</span>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? "bg-navy-900 text-cream-50"
                  : "bg-navy-900/5 text-navy-900/60 hover:bg-navy-900/10"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="hidden h-6 w-px bg-navy-900/10 sm:block" />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pr-1 text-xs font-semibold text-navy-900/35">요일</span>
          <button
            type="button"
            onClick={() => setDayFilter("all")}
            className={`rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
              dayFilter === "all"
                ? "bg-navy-900 text-cream-50"
                : "bg-navy-900/5 text-navy-900/60 hover:bg-navy-900/10"
            }`}
          >
            전체
          </button>
          {DAY_KEYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => setDayFilter((prev) => (prev === day ? "all" : day))}
              className={`relative h-9 w-9 rounded-full text-xs font-semibold transition-colors ${
                dayFilter === day
                  ? "bg-gold-500 text-navy-950"
                  : "bg-navy-900/5 text-navy-900/60 hover:bg-navy-900/10"
              }`}
            >
              {DAY_LABELS[day]}
              {todayKey === day && (
                <span
                  className={`absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ${
                    dayFilter === day ? "bg-navy-950" : "bg-gold-500"
                  }`}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {filtered.length > 0 && (
        <label className="flex items-center gap-2 text-xs font-medium text-navy-900/50 sm:hidden">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-navy-900/20"
            aria-label="전체 선택"
          />
          전체 선택 ({filtered.length}명)
        </label>
      )}

      <div className="flex flex-col gap-3 sm:hidden">
        {filtered.map((s) => (
          <div
            key={s.id}
            className="rounded-2xl bg-white p-4 shadow-[0_15px_40px_-30px_rgba(10,23,48,0.3)]"
          >
            <div className="flex items-start justify-between gap-3">
              <label className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleOne(s.id)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-navy-900/20"
                  aria-label={`${s.name} 선택`}
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-navy-900">{s.name}</span>
                  <span className="block text-xs text-navy-900/50">
                    {s.age != null ? `${s.age}세` : "-"}
                    {s.classDays.length > 0
                      ? ` · ${sortDayKeys(s.classDays)
                          .map((d) => DAY_LABELS[d])
                          .join("·")}`
                      : ""}
                  </span>
                </span>
              </label>
              <StatusBadge status={s.status} />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-navy-900/5 pt-3">
              <a
                href={telHref(s.parentPhone)}
                className="flex min-w-0 items-center gap-1.5 text-sm text-navy-900/60"
              >
                <PhoneIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{s.parentPhone}</span>
              </a>
              <div className="flex shrink-0 items-center gap-1">
                {s.status === "checked_in" && (
                  <button
                    type="button"
                    onClick={() => setConfirmTarget({ type: "checkout", student: s })}
                    aria-label={`${s.name} 하원 처리`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-gold-100 hover:text-gold-600"
                  >
                    <CheckOutIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  aria-label={`${s.name} 정보 수정`}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmTarget({ type: "delete", student: s })}
                  aria-label={`${s.name} 삭제`}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="rounded-2xl bg-white px-5 py-10 text-center text-sm text-navy-900/40">
            조건에 맞는 학생이 없습니다.
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-[1.75rem] bg-white shadow-[0_20px_60px_-30px_rgba(10,23,48,0.25)] sm:block">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-navy-900/5 text-xs font-medium uppercase tracking-wide text-navy-900/40">
              <th className="w-12 px-5 py-4">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-navy-900/20"
                  aria-label="전체 선택"
                />
              </th>
              <th className="px-3 py-4">이름</th>
              <th className="px-3 py-4">나이</th>
              <th className="px-3 py-4">요일</th>
              <th className="px-3 py-4">부모님 전화번호</th>
              <th className="px-3 py-4">상태</th>
              <th className="w-36 px-8 py-4 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-navy-900/5 last:border-0 hover:bg-navy-50/60">
                <td className="px-5 py-4">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleOne(s.id)}
                    className="h-4 w-4 rounded border-navy-900/20"
                    aria-label={`${s.name} 선택`}
                  />
                </td>
                <td className="px-3 py-4 font-semibold text-navy-900">{s.name}</td>
                <td className="px-3 py-4 text-navy-900/60">{s.age != null ? `${s.age}세` : "-"}</td>
                <td className="px-3 py-4 text-navy-900/60">
                  {s.classDays.length > 0
                    ? sortDayKeys(s.classDays)
                        .map((d) => DAY_LABELS[d])
                        .join("·")
                    : "-"}
                </td>
                <td className="px-3 py-4 text-navy-900/60">
                  <div className="flex items-center gap-2">
                    {s.parentPhone}
                    <a
                      href={telHref(s.parentPhone)}
                      aria-label={`${s.name} 부모님께 전화`}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-900/5 text-navy-900 transition-colors hover:bg-navy-900/10"
                    >
                      <PhoneIcon className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </td>
                <td className="px-3 py-4">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-3 py-4">
                  <div className="flex items-center justify-end gap-1">
                    {s.status === "checked_in" && (
                      <button
                        type="button"
                        onClick={() => setConfirmTarget({ type: "checkout", student: s })}
                        aria-label={`${s.name} 하원 처리`}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-gold-100 hover:text-gold-600"
                      >
                        <CheckOutIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      aria-label={`${s.name} 정보 수정`}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmTarget({ type: "delete", student: s })}
                      aria-label={`${s.name} 삭제`}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-navy-900/40">
                  조건에 맞는 학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <StudentFormModal
        key={`form-${formModal.nonce}`}
        open={formModal.open}
        onClose={closeForm}
        student={formModal.student}
      />

      <ConfirmModal
        open={confirmTarget !== null}
        title={confirmTarget?.type === "checkout" ? "하원 처리" : "학생 삭제"}
        message={
          confirmTarget?.type === "checkout"
            ? `${confirmTarget.student.name} 학생을 지금 하원 처리할까요? 등원 후 50분이 지나지 않았어도 처리됩니다.`
            : `${confirmTarget?.student.name ?? ""} 학생을 삭제할까요? 출석 기록을 포함해 모든 정보가 영구적으로 삭제되며 복구할 수 없습니다.`
        }
        confirmLabel={confirmTarget?.type === "checkout" ? "하원 처리" : "삭제"}
        pending={confirmPending}
        onConfirm={runConfirm}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}
