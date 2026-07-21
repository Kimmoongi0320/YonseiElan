type MusicNotesBackgroundProps = {
  className?: string;
};

/**
 * Decorative, tiled music-note pattern for section backgrounds.
 * Pure SVG (no image asset) so it stays crisp at any viewport size.
 */
export function MusicNotesBackground({ className }: MusicNotesBackgroundProps) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern
          id="music-notes-pattern"
          x="0"
          y="0"
          width="220"
          height="220"
          patternUnits="userSpaceOnUse"
        >
          {/* single eighth note */}
          <g transform="translate(18, 24) rotate(-8)" fill="var(--color-navy-900)">
            <ellipse cx="0" cy="16" rx="6.5" ry="4.8" transform="rotate(-18 0 16)" />
            <rect x="5.6" y="-16" width="2" height="32" rx="1" />
            <path d="M7.6 -16 C 18 -12, 17 2, 7.6 6 C 14 -2, 13 -11, 7.6 -16 Z" />
          </g>

          {/* beamed pair of eighth notes */}
          <g transform="translate(110, 46) rotate(6)" fill="var(--color-gold-500)">
            <ellipse cx="0" cy="18" rx="6" ry="4.4" transform="rotate(-16 0 18)" />
            <ellipse cx="34" cy="18" rx="6" ry="4.4" transform="rotate(-16 34 18)" />
            <rect x="5.2" y="-14" width="1.8" height="32" rx="0.9" />
            <rect x="39.2" y="-14" width="1.8" height="32" rx="0.9" />
            <path d="M6 -14 L 40 -10 L 40 -5 L 6 -9 Z" />
          </g>

          {/* small quarter note */}
          <g transform="translate(150, 140) rotate(-12)" fill="var(--color-navy-900)">
            <ellipse cx="0" cy="10" rx="5.2" ry="3.9" transform="rotate(-18 0 10)" />
            <rect x="4.6" y="-14" width="1.8" height="24" rx="0.9" />
          </g>

          {/* single eighth note, smaller + lighter */}
          <g
            transform="translate(52, 130) rotate(14)"
            fill="var(--color-navy-900)"
            opacity="0.85"
          >
            <ellipse cx="0" cy="12" rx="5" ry="3.7" transform="rotate(-18 0 12)" />
            <rect x="4.4" y="-13" width="1.7" height="25" rx="0.85" />
            <path d="M6 -13 C 14 -10, 13.5 0, 6 3.5 C 10.5 -2, 9.8 -8.5, 6 -13 Z" />
          </g>

          {/* treble clef, subtle accent */}
          <g transform="translate(180, 190) scale(0.55)" fill="var(--color-gold-500)">
            <path d="M12 2c-3.2 0-5.6 2.6-5.6 5.7 0 2.1 1.1 3.9 3.4 6.4-2.6 5.1-3.8 8.3-3.8 11.4 0 4.3 2.9 7.3 6.9 7.3 3.6 0 6.3-2.3 6.9-5.8.5-2.9-.7-5.6-3.4-7.1l-.4 2.1c1.4 1 2.1 2.4 1.8 4.1-.3 1.9-1.8 3.1-3.7 3.1-2.2 0-3.7-1.6-3.7-3.9 0-2.4 1-5 3.3-9.5 2.1 2.2 3.1 4 3.1 6a4 4 0 0 1-.2 1.3l2-.4c.1-.5.1-.9.1-1.4 0-2.6-1.3-4.8-3.8-7.3 1.7-1.9 2.4-3.5 2.4-5.2C17.6 4.3 15.4 2 12 2Zm0 2c1.9 0 3 1.3 3 3.3 0 1.2-.6 2.4-2 3.9-1.6-1.7-2.4-3-2.4-4.3 0-1.7 1.1-2.9 3.4-2.9Z" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#music-notes-pattern)" />
    </svg>
  );
}
