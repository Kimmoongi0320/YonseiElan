import fs from "fs";
import path from "path";
import Image from "next/image";
import { LogoMark } from "./logo-mark";

const LOGO_FILE = path.join(process.cwd(), "public", "logo.png");

type LogoProps = {
  size?: number;
  className?: string;
};

/** Reads width/height straight from the PNG's IHDR chunk (bytes 16-23). */
function readPngSize(file: string): { width: number; height: number } {
  const fd = fs.openSync(file, "r");
  const header = Buffer.alloc(24);
  fs.readSync(fd, header, 0, 24, 0);
  fs.closeSync(fd);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/**
 * Renders /public/logo.png once it exists; falls back to the placeholder
 * SVG crest so the app isn't broken before the real file is added.
 */
export function Logo({ size = 40, className }: LogoProps) {
  if (fs.existsSync(LOGO_FILE)) {
    const { width, height } = readPngSize(LOGO_FILE);
    return (
      <Image
        src="/logo.png"
        alt="엘랑 피아노 학원 로고"
        width={size}
        height={Math.round((size * height) / width)}
        className={className}
        priority
      />
    );
  }

  return <LogoMark size={size} className={className} />;
}
