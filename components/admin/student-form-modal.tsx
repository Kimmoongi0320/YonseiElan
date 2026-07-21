"use client";

import { useActionState, useEffect, useRef, type ChangeEvent } from "react";
import { Modal } from "@/components/modal";
import { upsertStudentAction, type StudentFormState } from "@/app/admin/actions";
import type { AdminStudent } from "@/lib/students";
import { DAY_KEYS, DAY_LABELS } from "@/lib/schedule";

const inputClass =
  "w-full rounded-2xl border border-navy-900/10 bg-white px-4 py-3 text-navy-900 placeholder:text-navy-900/30 focus:outline-none focus:ring-2 focus:ring-navy-900/20";

const PHONE_PATTERN = "0\\d{1,2}-?\\d{3,4}-?\\d{4}";

function formatPhoneNumber(digits: string) {
  const isSeoul = digits.startsWith("02");
  const areaLength = isSeoul ? 2 : 3;
  const area = digits.slice(0, areaLength);
  const rest = digits.slice(areaLength);

  // 총 국번+뒷자리가 7자리인 경우(일반 유선 10자리)만 3-4로, 그 외(휴대폰 등)는 4-4로 나눔
  const [middle, last] =
    rest.length === 7 ? [rest.slice(0, 3), rest.slice(3)] : [rest.slice(0, 4), rest.slice(4)];

  return [area, middle, last].filter(Boolean).join("-");
}

function handlePhoneInput(event: ChangeEvent<HTMLInputElement>) {
  const digits = event.target.value.replace(/\D/g, "").slice(0, 11);
  event.target.value = formatPhoneNumber(digits);
}

type Props = {
  open: boolean;
  onClose: () => void;
  student: AdminStudent | null;
};

export function StudentFormModal({ open, onClose, student }: Props) {
  const [state, formAction, pending] = useActionState<StudentFormState, FormData>(
    upsertStudentAction,
    null
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state) {
      onClose();
    }
    wasPending.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state]);

  return (
    <Modal open={open} onClose={onClose}>
      <form action={formAction} className="flex flex-col gap-5">
        <h2 className="text-lg font-bold text-navy-900">
          {student ? "학생 정보 수정" : "학생 등록"}
        </h2>

        <input type="hidden" name="id" value={student?.id ?? ""} />

        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
          이름
          <input
            type="text"
            name="name"
            required
            defaultValue={student?.name ?? ""}
            placeholder="예: 김민준"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
          나이
          <input
            type="number"
            name="age"
            min={0}
            max={100}
            defaultValue={student?.age ?? ""}
            placeholder="선택 입력"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
          부모님 전화번호
          <input
            type="tel"
            name="parentPhone"
            required
            inputMode="numeric"
            pattern={PHONE_PATTERN}
            title="전화번호 형식으로 입력해주세요. (예: 010-1234-5678)"
            onChange={handlePhoneInput}
            defaultValue={student?.parentPhone ?? ""}
            placeholder="010-1234-5678"
            className={inputClass}
          />
        </label>

        <div className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
          수업 요일
          <div className="flex flex-wrap gap-2">
            {DAY_KEYS.map((day) => (
              <label
                key={day}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-navy-900/10 bg-white text-sm font-semibold text-navy-900/60 transition-colors has-checked:border-navy-900 has-checked:bg-navy-900 has-checked:text-cream-50"
              >
                <input
                  type="checkbox"
                  name="classDays"
                  value={day}
                  defaultChecked={student?.classDays.includes(day) ?? false}
                  className="sr-only"
                />
                {DAY_LABELS[day]}
              </label>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
          메모
          <textarea
            name="memo"
            rows={3}
            defaultValue={student?.memo ?? ""}
            placeholder="특이사항을 입력해주세요 (선택)"
            className={`${inputClass} resize-none`}
          />
        </label>

        {state?.error && (
          <p className="text-sm text-rose-600" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-bold text-cream-50 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "저장 중..." : student ? "수정하기" : "등록하기"}
        </button>
      </form>
    </Modal>
  );
}
