import { renderAdminIcon } from "@/lib/admin-icon";

export const dynamic = "force-static";

export async function GET() {
  return renderAdminIcon({ size: 192 });
}
