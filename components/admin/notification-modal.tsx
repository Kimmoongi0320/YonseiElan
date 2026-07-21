"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { Modal } from "@/components/modal";
import { sendNotificationAction, type NotificationFormState } from "@/app/admin/actions";
import { NOTIFICATION_TEMPLATES } from "@/lib/notifications";

type Recipient = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  recipients: Recipient[];
  onSent: () => void;
};

export function NotificationModal({ open, onClose, recipients, onSent }: Props) {
  const [state, formAction, pending] = useActionState<NotificationFormState, FormData>(
    sendNotificationAction,
    null
  );
  const [templateKey, setTemplateKey] = useState("custom");
  const [message, setMessage] = useState("");
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state) {
      onSent();
      onClose();
    }
    wasPending.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state]);

  return (
    <Modal open={open} onClose={onClose}>
      <form action={formAction} className="flex flex-col gap-5">
        <h2 className="text-lg font-bold text-navy-900">알림 보내기</h2>

        <div className="flex flex-wrap gap-2">
          {recipients.map((r) => (
            <span
              key={r.id}
              className="rounded-full bg-navy-900/5 px-3 py-1 text-xs font-medium text-navy-900"
            >
              {r.name}
            </span>
          ))}
          {recipients.map((r) => (
            <input key={r.id} type="hidden" name="studentIds" value={r.id} />
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-navy-900/70">템플릿 선택</span>
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTemplateKey(t.key);
                  setMessage(t.message);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  templateKey === t.key
                    ? "border-navy-900 bg-navy-900 text-cream-50"
                    : "border-navy-900/10 bg-white text-navy-900/70 hover:bg-navy-900/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <input type="hidden" name="templateKey" value={templateKey} />

        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy-900/70">
          메시지 내용
          <textarea
            name="message"
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="보낼 메시지를 입력해주세요"
            className="w-full resize-none rounded-2xl border border-navy-900/10 bg-white px-4 py-3 text-navy-900 placeholder:text-navy-900/30 focus:outline-none focus:ring-2 focus:ring-navy-900/20"
          />
          <span className="text-xs text-navy-900/40">
            {"{name}"} 은 학생별로 이름으로 자동 치환되어 전송됩니다.
          </span>
        </label>

        {state?.error && (
          <p className="text-sm text-rose-600" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || recipients.length === 0}
          className="w-full rounded-2xl bg-gold-500 py-3.5 text-base font-bold text-navy-950 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "전송 중..." : `${recipients.length}명에게 전송`}
        </button>
      </form>
    </Modal>
  );
}
