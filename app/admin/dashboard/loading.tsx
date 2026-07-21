import { SpinnerIcon } from "@/components/icons";

export default function DashboardLoading() {
  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col items-center justify-center gap-3 bg-cream-50 px-4">
      <SpinnerIcon className="h-6 w-6 animate-spin text-navy-900/40" />
      <p className="text-sm text-navy-900/50">불러오는 중...</p>
    </div>
  );
}
