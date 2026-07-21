import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export async function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: "/admin",
    name: "엘랑 피아노 학원 관리자",
    short_name: "엘랑 관리자",
    description: "엘랑 피아노 학원 학생 출입 관리자 페이지",
    lang: "ko",
    start_url: "/admin/dashboard",
    scope: "/admin",
    display: "standalone",
    background_color: "#faf7f1",
    theme_color: "#0f2447",
    icons: [
      { src: "/admin/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/admin/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/admin/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/admin/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
