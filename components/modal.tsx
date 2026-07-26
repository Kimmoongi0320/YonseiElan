"use client";

import { useEffect, useRef } from "react";
import { XIcon } from "./icons";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClassName?: string;
};

export function Modal({ open, onClose, children, maxWidthClassName = "max-w-sm" }: ModalProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pushedHistoryRef = useRef(false);
  const ignoreNextPopRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    const { body } = document;
    const scrollY = window.scrollY;
    const previousStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previousStyle.position;
      body.style.top = previousStyle.top;
      body.style.left = previousStyle.left;
      body.style.right = previousStyle.right;
      body.style.overflow = previousStyle.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    window.history.pushState({ modalOpen: true }, "");
    pushedHistoryRef.current = true;

    const handlePopState = () => {
      // Dev-mode Strict Mode double-invokes this effect (mount, cleanup, mount),
      // and the cleanup's corrective history.back() below resolves asynchronously
      // as its own popstate event. Without this guard, that self-triggered event
      // lands on the second mount's listener and closes the modal right after it
      // opens. A real back-button press never sets this flag, so it still closes.
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      pushedHistoryRef.current = false;
      onCloseRef.current();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        ignoreNextPopRef.current = true;
        window.history.back();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/45 px-4 py-6 animate-fade-in-up sm:py-10">
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex max-h-full w-full ${maxWidthClassName} flex-col overflow-y-auto rounded-[2rem] bg-white p-6 shadow-[0_30px_80px_-20px_rgba(10,23,48,0.35)] sm:p-8`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-4 top-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-navy-900/40 transition-colors hover:bg-navy-900/5 hover:text-navy-900 sm:right-5 sm:top-5"
        >
          <XIcon className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
