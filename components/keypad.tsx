"use client";

const KEY_STYLE =
  "flex h-16 w-16 items-center justify-center rounded-2xl border border-navy-900/10 bg-white text-2xl font-semibold text-navy-900 shadow-sm transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-navy-900/5 active:scale-95 disabled:opacity-40";

type KeypadProps = {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
  confirm: {
    label: string;
    onConfirm: () => void;
    disabled: boolean;
  };
};

export function Keypad({ onDigit, onBackspace, disabled, confirm }: KeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onDigit(d)}
          disabled={disabled}
          className={KEY_STYLE}
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        onClick={onBackspace}
        disabled={disabled}
        className={`${KEY_STYLE} text-sm font-medium`}
      >
        지우기
      </button>
      <button type="button" onClick={() => onDigit("0")} disabled={disabled} className={KEY_STYLE}>
        0
      </button>
      <button
        type="button"
        onClick={confirm.onConfirm}
        disabled={disabled || confirm.disabled}
        className={`${KEY_STYLE} bg-navy-900 text-sm font-medium text-cream-50 hover:bg-navy-800 disabled:bg-navy-900/20 disabled:text-navy-900/40`}
      >
        {confirm.label}
      </button>
    </div>
  );
}
