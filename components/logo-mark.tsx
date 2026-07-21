type LogoMarkProps = {
  size?: number;
  className?: string;
};

/**
 * Placeholder mark, standing in for the academy's real crest until
 * /public/logo.png is added (see LogoImage in header.tsx).
 */
export function LogoMark({ size = 40, className }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="엘랑 피아노 학원 로고"
    >
      <path
        d="M32 3 L54 11 V30 C54 46 44 56 32 61 C20 56 10 46 10 30 V11 Z"
        fill="none"
        stroke="var(--color-navy-900)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M32 8 L48 14 V30 C48 43 40 51.5 32 55.5 C24 51.5 16 43 16 30 V14 Z"
        fill="none"
        stroke="var(--color-gold-500)"
        strokeWidth="1"
      />
      <g transform="translate(21, 22)">
        <rect x="0" y="0" width="22" height="18" rx="1.5" fill="var(--color-navy-900)" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={1 + i * 4}
            y="1"
            width="3.2"
            height="16"
            fill={i === 2 ? "var(--color-gold-400)" : "#faf7f1"}
          />
        ))}
      </g>
    </svg>
  );
}
