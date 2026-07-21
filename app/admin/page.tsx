"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BackspaceIcon, ChevronLeftIcon, LockIcon, SpinnerIcon } from "@/components/icons";

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"];

export default function AdminAuthPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string>("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (pin: string) => {
    setPending(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        router.push("/admin/dashboard");
        return;
      }
      setError(true);
      setDigits("");
      setPending(false);
    } catch {
      setError(true);
      setDigits("");
      setPending(false);
    }
  };

  const handleKey = (key: string) => {
    if (pending) return;
    setError(false);

    if (key === "backspace") {
      setDigits((prev) => prev.slice(0, -1));
      return;
    }
    if (key === "" || digits.length >= PIN_LENGTH) return;

    const next = digits + key;
    setDigits(next);
    if (next.length === PIN_LENGTH) {
      submit(next);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col items-center justify-center gap-8 bg-cream-50 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-900/5 text-navy-900">
          {pending ? (
            <SpinnerIcon className="h-5 w-5 animate-spin" />
          ) : (
            <LockIcon className="h-5 w-5" />
          )}
        </span>
        <h1 className="text-xl font-bold text-navy-900">관리자 인증</h1>
        <p className="text-sm text-navy-900/50">
          {pending ? "로그인 중..." : "4자리 비밀번호를 입력하세요"}
        </p>
      </div>

      <div className={`flex items-center gap-4 ${error ? "animate-shake" : ""}`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${
              i < digits.length ? "border-navy-900 bg-navy-900" : "border-navy-900/20"
            }`}
          />
        ))}
      </div>

      <p className="h-5 text-sm font-medium text-rose-600" role="alert">
        {error ? "비밀번호가 올바르지 않습니다" : ""}
      </p>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key, i) => {
          if (key === "") return <div key={i} />;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleKey(key)}
              disabled={pending}
              className="flex h-16 w-16 items-center justify-center rounded-2xl border border-navy-900/10 bg-white text-2xl font-semibold text-navy-900 shadow-sm transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-navy-900/5 active:scale-95 disabled:opacity-50"
            >
              {key === "backspace" ? <BackspaceIcon className="h-5 w-5" /> : key}
            </button>
          );
        })}
      </div>

      <Link
        href="/"
        className="mt-2 flex items-center gap-1.5 text-sm text-navy-900/50 transition-colors hover:text-navy-900"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        홈으로
      </Link>
    </div>
  );
}
