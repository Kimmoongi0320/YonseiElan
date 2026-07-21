import Link from "next/link";
import { Logo } from "@/components/logo";
import { LockIcon } from "@/components/icons";
import { AttendanceFlow } from "@/components/attendance-flow";
import { MusicNotesBackground } from "@/components/music-notes-background";

export default function Home() {
  return (
    <div className="relative flex min-h-[100dvh] flex-1 flex-col overflow-hidden bg-cream-50">
      <MusicNotesBackground className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06]" />

      <header className="relative z-10 flex items-center gap-3 px-6 pt-6 sm:px-10 sm:pt-8">
        <Logo size={40} />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-navy-900">
            연세엘랑 피아노 학원
          </p>
          <p className="text-[11px] uppercase tracking-[0.15em] text-navy-900/40">
            Yonsei Elan Piano Academy
          </p>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 sm:gap-10 sm:py-16">
        <div className="animate-fade-in-up text-center">
          <p className="text-sm font-medium text-navy-900/50">
            안녕하세요, 연세엘랑 피아노 학원입니다
          </p>
          <h1 className="mt-2 text-xl font-bold leading-snug text-navy-900 sm:mt-3 sm:text-3xl">
            등원 또는 하원을 선택해 주세요
          </h1>
        </div>

        <AttendanceFlow />
      </main>

      <div className="relative z-10 flex justify-end px-4 pb-4 sm:px-6 sm:pb-6">
        <Link
          href="/admin"
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs text-navy-900/35 transition-colors hover:text-navy-900/70"
        >
          <LockIcon className="h-3.5 w-3.5" />
          관리자
        </Link>
      </div>
    </div>
  );
}
