import { ImageResponse } from "next/og";

const NAVY = "#0f2447";
const CREAM = "#faf7f1";
const GOLD = "#dab264";

type RenderAdminIconOptions = {
  size: number;
  /** Keeps the artwork inside the safe zone and drops the corner rounding, for Android maskable / iOS home screen icons. */
  maskable?: boolean;
};

export function renderAdminIcon({ size, maskable = false }: RenderAdminIconOptions) {
  const padding = maskable ? size * 0.22 : size * 0.16;
  const barCount = 5;
  const barGap = size * 0.03;
  const contentWidth = size - padding * 2;
  const barWidth = (contentWidth - barGap * (barCount - 1)) / barCount;
  const barHeight = contentWidth * (16 / 22);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: NAVY,
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: barGap,
            width: contentWidth,
            height: barHeight,
          }}
        >
          {Array.from({ length: barCount }).map((_, i) => (
            <div
              key={i}
              style={{
                width: barWidth,
                height: "100%",
                borderRadius: barWidth * 0.3,
                background: i === 2 ? GOLD : CREAM,
              }}
            />
          ))}
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
