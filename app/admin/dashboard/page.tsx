import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logoutAdmin } from "../actions";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { ChangePinButton } from "@/components/admin/change-pin-modal";
import { listStudentsForAdmin } from "@/lib/students";

export default async function AdminDashboardPage() {
  const cookieStore = await cookies();
  if (cookieStore.get("elan_admin_session")?.value !== "authenticated") {
    redirect("/admin");
  }

  const students = await listStudentsForAdmin();

  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col bg-cream-50 px-4 pb-12 pt-6 sm:px-10 sm:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold text-navy-900 sm:text-xl">관리자 대시보드</h1>
        <div className="flex items-center gap-2">
          <ChangePinButton />
          <form action={logoutAdmin}>
            <button
              type="submit"
              className="rounded-full bg-navy-900/5 px-4 py-2 text-sm font-medium text-navy-900 transition-colors hover:bg-navy-900/10"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>

      <AdminDashboard students={students} />
    </div>
  );
}
