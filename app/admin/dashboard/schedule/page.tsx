import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/icons";
import { listActiveStudentsForSchedule } from "@/lib/students";
import { ScheduleCalendar } from "@/components/admin/schedule-calendar";

export default async function AdminSchedulePage() {
  const cookieStore = await cookies();
  if (cookieStore.get("elan_admin_session")?.value !== "authenticated") {
    redirect("/admin");
  }

  const students = await listActiveStudentsForSchedule();

  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col bg-cream-50 px-4 pb-12 pt-6 sm:px-10 sm:py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dashboard"
            aria-label="목록으로"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Link>
          <h1 className="truncate text-lg font-bold text-navy-900 sm:text-xl">전체 일정</h1>
        </div>

        <ScheduleCalendar students={students} />
      </div>
    </div>
  );
}
