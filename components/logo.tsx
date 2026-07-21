import fs from "fs";
import path from "path";
import Image from "next/image";
import { LogoMark } from "./logo-mark";

const LOGO_FILE = path.join(process.cwd(), "public", "logo.png");

type LogoProps = {
  size?: number;
  className?: string;
};

/**
 * Renders /public/logo.png once it exists; falls back to the placeholder
 * SVG crest so the app isn't broken before the real file is added.
 */
export function Logo({ size = 40, className }: LogoProps) {
  if (fs.existsSync(LOGO_FILE)) {
    return (
      <Image
        src="/logo.png"
        alt="엘랑 피아노 학원 로고"
        width={size}
        height={size}
        className={className}
        priority
      />
    );
  }

  return <LogoMark size={size} className={className} />;
}
