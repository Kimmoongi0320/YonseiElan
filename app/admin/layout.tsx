import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "엘랑 피아노 학원 | 관리자",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "엘랑 관리자",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f2447",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
