import fs from "fs";
import path from "path";
import { ImageResponse } from "next/og";

const CREAM = "#faf7f1";

const LOGO_DATA_URL = `data:image/png;base64,${fs
  .readFileSync(path.join(process.cwd(), "public", "logo.png"))
  .toString("base64")}`;

type RenderAppIconOptions = {
  size: number;
  /** Keeps the artwork inside the safe zone and drops the corner rounding, for Android maskable / iOS home screen icons. */
  maskable?: boolean;
};

export function renderAppIcon({ size, maskable = false }: RenderAppIconOptions) {
  const padding = maskable ? size * 0.2 : size * 0.1;
  const artSize = size - padding * 2;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: CREAM,
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_DATA_URL} width={artSize} height={artSize} />
      </div>
    ),
    { width: size, height: size }
  );
}
