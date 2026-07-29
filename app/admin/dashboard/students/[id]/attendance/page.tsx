import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/icons";
import { getStudentSummaryForAdmin } from "@/lib/students";
import { freezeStudentPaymentHistory } from "@/lib/student-payment-overrides";
import { AttendanceCalendar } from "@/components/admin/attendance-calendar";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StudentAttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  if (cookieStore.get("elan_admin_session")?.value !== "authenticated") {
    redirect("/admin");
  }

  const { id } = await params;
  // Must run before fetching the summary below — freeze can roll
  // students.payment_day forward when a past cycle resolved via override or
  // pause delay, and the badge/calendar on this page need that fresh value
  // rather than the pre-freeze one.
  if (UUID_RE.test(id)) {
    await freezeStudentPaymentHistory(id);
  }
  const student = await getStudentSummaryForAdmin(id);
  if (!student) notFound();

  return (
    <div className="flex min-h-dvh-safe flex-1 flex-col bg-cream-50 px-4 pb-12 pt-6 sm:px-10 sm:py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col space-y-6">
        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-3 sm:space-y-0">
          <div className="flex items-center space-x-2">
            <Link
              href="/admin/dashboard"
              aria-label="목록으로"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy-900/50 transition-colors hover:bg-navy-900/5 hover:text-navy-900"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Link>
            <h1 className="truncate text-lg font-bold text-navy-900 sm:text-xl">{student.name} 출석 달력</h1>
          </div>
          {student.paymentDay != null && (
            <span className="inline-flex w-fit items-center space-x-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600">
              <span
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-500 text-[8px] font-bold text-white"
                aria-hidden="true"
              >
                ₩
              </span>
              결제일 매월 {student.paymentDay}일
            </span>
          )}
        </div>

        <AttendanceCalendar student={student} />
      </div>
    </div>
  );
}
