"use client";

import { Modal } from "@/components/modal";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({ open, title, message, confirmLabel, pending, onConfirm, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col items-center gap-5 text-center">
        <h2 className="text-lg font-bold text-navy-900">{title}</h2>
        <p className="text-sm text-navy-900/60">{message}</p>
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="flex-1 rounded-2xl bg-navy-900/5 py-3 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-900/10 disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 rounded-2xl bg-navy-900 py-3 text-sm font-semibold text-cream-50 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
