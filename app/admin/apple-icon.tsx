import { renderAdminIcon } from "@/lib/admin-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return renderAdminIcon({ size: 180, maskable: true });
}
