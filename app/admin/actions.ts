"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createStudent, deleteStudent, findStudentById, updateStudent } from "@/lib/students";
import { adminCheckOut } from "@/lib/attendance";
import { NOTIFICATION_TEMPLATES } from "@/lib/notifications";
import { isDayKey, type DayKey } from "@/lib/schedule";
import { updateAdminPin, verifyAdminPin } from "@/lib/admin-settings";

const SESSION_COOKIE = "elan_admin_session";
const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
const PIN_RE = /^\d{4}$/;

async function requireAdminSession() {
  const cookieStore = await cookies();
  if (cookieStore.get(SESSION_COOKIE)?.value !== "authenticated") {
    throw new Error("Unauthorized");
  }
}

export async function logoutAdmin() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/");
}

export type StudentFormState = { error: string } | null;

export async function upsertStudentAction(
  _prevState: StudentFormState,
  formData: FormData
): Promise<StudentFormState> {
  await requireAdminSession();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const ageRaw = String(formData.get("age") ?? "").trim();
  const parentPhone = String(formData.get("parentPhone") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const classDaysRaw = formData.getAll("classDays").map(String);

  if (!name) {
    return { error: "이름을 입력해주세요." };
  }
  if (!PHONE_RE.test(parentPhone)) {
    return { error: "부모님 전화번호 형식을 확인해주세요. (예: 010-1234-5678)" };
  }
  if (!classDaysRaw.every(isDayKey)) {
    return { error: "요일 값이 올바르지 않습니다." };
  }

  let age: number | null = null;
  if (ageRaw) {
    age = Number(ageRaw);
    if (!Number.isInteger(age) || age < 0 || age > 100) {
      return { error: "나이를 올바르게 입력해주세요." };
    }
  }

  const input = { name, age, parentPhone, memo, classDays: classDaysRaw as DayKey[] };

  if (id) {
    if (!(await findStudentById(id))) {
      return { error: "학생 정보를 찾을 수 없습니다." };
    }
    await updateStudent(id, input);
  } else {
    await createStudent(input);
  }

  revalidatePath("/admin/dashboard");
  return null;
}

export async function deleteStudentAction(id: string) {
  await requireAdminSession();
  await deleteStudent(id);
  revalidatePath("/admin/dashboard");
}

export async function adminCheckOutAction(studentId: string): Promise<{ ok: boolean }> {
  await requireAdminSession();
  const result = await adminCheckOut(studentId);
  revalidatePath("/admin/dashboard");
  return { ok: result.ok };
}

export type NotificationFormState = { error: string } | null;

export async function sendNotificationAction(
  _prevState: NotificationFormState,
  formData: FormData
): Promise<NotificationFormState> {
  await requireAdminSession();

  const studentIds = formData.getAll("studentIds").map(String).filter(Boolean);
  const message = String(formData.get("message") ?? "").trim();
  const templateKey = String(formData.get("templateKey") ?? "") || null;

  if (studentIds.length === 0) {
    return { error: "알림을 받을 학생을 선택해주세요." };
  }
  if (!message) {
    return { error: "메시지 내용을 입력해주세요." };
  }
  if (templateKey && !NOTIFICATION_TEMPLATES.some((t) => t.key === templateKey)) {
    return { error: "알 수 없는 템플릿입니다." };
  }

  // Delivery (e.g. KakaoTalk) is wired up separately — this only validates the request for now.
  return null;
}

export type ChangePinFormState = { error: string } | { success: true } | null;

export async function changeAdminPinAction(
  _prevState: ChangePinFormState,
  formData: FormData
): Promise<ChangePinFormState> {
  await requireAdminSession();

  const currentPin = String(formData.get("currentPin") ?? "");
  const newPin = String(formData.get("newPin") ?? "");
  const confirmPin = String(formData.get("confirmPin") ?? "");

  if (!PIN_RE.test(currentPin) || !PIN_RE.test(newPin) || !PIN_RE.test(confirmPin)) {
    return { error: "비밀번호는 4자리 숫자여야 합니다." };
  }
  if (newPin !== confirmPin) {
    return { error: "새 비밀번호가 일치하지 않습니다." };
  }
  if (newPin === currentPin) {
    return { error: "현재 비밀번호와 다른 비밀번호를 입력해주세요." };
  }
  if (!(await verifyAdminPin(currentPin))) {
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }

  await updateAdminPin(newPin);
  return { success: true };
}
