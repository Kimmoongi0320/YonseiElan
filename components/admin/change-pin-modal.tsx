"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { changeAdminPinAction, type ChangePinFormState } from "@/app/admin/actions";

const inputClass =
  "w-full rounded-2xl border border-navy-900/10 bg-white px-4 py-3 text-center text-lg tracking-[0.5em] text-navy-900 placeholder:tracking-normal placeholder:text-navy-900/30 focus:outline-none focus:ring-2 focus:ring-navy-900/20";

export function ChangePinButton() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ChangePinFormState, FormData>(
    changeAdminPinAction,
    null
  );
  const wasPending = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (wasPending.current && !pending && state && "success" in state) {
      formRef.current?.reset();
      setOpen(false);
    }
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-navy-900/5 px-4 py-2 text-sm font-medium text-navy-900 transition-colors hover:bg-navy-900/10"
      >
        비밀번호 변경
      </button>

      <Modal open={open} onClose={() => setOpen(false)}>
        <form ref={formRef} action={formAction} className="flex flex-col gap-5">
          <h2 className="text-lg font-bold text-navy-900">관리자 비밀번호 변경</h2>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
            현재 비밀번호
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              name="currentPin"
              maxLength={4}
              required
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
            새 비밀번호
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              name="newPin"
              maxLength={4}
              required
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
            새 비밀번호 확인
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              name="confirmPin"
              maxLength={4}
              required
              className={inputClass}
            />
          </label>

          {state && "error" in state && (
            <p className="text-sm text-rose-600" role="alert">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-navy-900 py-3.5 text-base font-bold text-cream-50 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "변경 중..." : "변경하기"}
          </button>
        </form>
      </Modal>
    </>
  );
}
