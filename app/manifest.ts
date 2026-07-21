import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "연세엘랑 피아노 학원",
    short_name: "엘랑 피아노",
    description: "연세엘랑 피아노 학원 학생 등원·하원 관리 시스템",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf7f1",
    theme_color: "#0f2447",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
