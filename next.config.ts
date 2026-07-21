import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 같은 네트워크의 다른 기기(태블릿/휴대폰 등)에서 "Network:" URL로 접속할 때
  // Next.js dev 서버가 HMR/dev 리소스 요청을 차단하지 않도록 허용 목록에 추가.
  allowedDevOrigins: ["172.25.208.1", "172.168.1.42"],
};

export default nextConfig;
