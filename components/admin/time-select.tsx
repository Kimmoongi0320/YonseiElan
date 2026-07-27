"use client";

import { useState } from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function splitTime(time: string): { hour: string; minute: string } {
  const [h, m] = time.split(":");
  return { hour: h ?? "", minute: m ?? "" };
}

type Props = {
  // Renders a hidden input under this name holding the combined "HH:MM"
  // value, for plain <form action={...}> submission (see student-form-modal).
  name?: string;
  // Controlled usage (see attendance-calendar's makeup time picker).
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
};

// Renders a time as separate hour/minute <select>s, with minutes restricted
// to 5-minute steps — a native <input type="time" step={300}> only nudges
// the spinner buttons in 5-minute increments, but admins can still type or
// scroll to an arbitrary minute in most browsers, so it doesn't actually
// enforce the restriction.
export function TimeSelect({ name, value, defaultValue, onChange, required, disabled }: Props) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(() => splitTime(defaultValue ?? ""));
  const { hour, minute } = isControlled ? splitTime(value) : internal;

  const setHour = (nextHour: string) => {
    if (!isControlled) setInternal({ hour: nextHour, minute });
    onChange?.(nextHour && minute ? `${nextHour}:${minute}` : "");
  };

  const setMinute = (nextMinute: string) => {
    if (!isControlled) setInternal({ hour, minute: nextMinute });
    onChange?.(hour && nextMinute ? `${hour}:${nextMinute}` : "");
  };

  const selectClass =
    "rounded-2xl border border-navy-900/10 bg-white px-2 py-2 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-900/20 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="시"
        value={hour}
        disabled={disabled}
        required={required}
        onChange={(e) => setHour(e.target.value)}
        className={selectClass}
      >
        <option value="" disabled>
          시
        </option>
        {HOURS.map((h) => (
          <option key={h} value={pad2(h)}>
            {pad2(h)}
          </option>
        ))}
      </select>
      <span className="text-navy-900/40">:</span>
      <select
        aria-label="분"
        value={minute}
        disabled={disabled}
        required={required}
        onChange={(e) => setMinute(e.target.value)}
        className={selectClass}
      >
        <option value="" disabled>
          분
        </option>
        {MINUTES.map((m) => (
          <option key={m} value={pad2(m)}>
            {pad2(m)}
          </option>
        ))}
      </select>
      {name && <input type="hidden" name={name} value={hour && minute ? `${hour}:${minute}` : ""} />}
    </div>
  );
}
