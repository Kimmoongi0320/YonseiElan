import { renderAppIcon } from "@/lib/app-icon";

export const dynamic = "force-static";

export async function GET() {
  return renderAppIcon({ size: 192 });
}
