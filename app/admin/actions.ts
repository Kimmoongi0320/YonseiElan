"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createStudent,
  deleteStudent,
  findStudentById,
  findStudentForEdit,
  findStudentsByIds,
  todayKstDateStr,
  updateStudent,
} from "@/lib/students";
import { adminBulkCheckOut, adminCheckOut } from "@/lib/attendance";
import { sendAdminAttendanceAlert, sendAdminAttendanceAlerts } from "@/lib/attendance-alert";
import {
  clearAttendanceDayRecords,
  clearAttendanceOverride,
  getStudentMonthAttendance,
  setAttendanceMakeupDate,
  setAttendanceMakeupRequired,
  setAttendanceOverride,
  type DayAttendanceInfo,
} from "@/lib/attendance-calendar";
import { NOTIFICATION_TEMPLATES } from "@/lib/notifications";
import { DAY_LABELS, isDayKey, TIME_RE, type ClassTimes, type DayKey } from "@/lib/schedule";
import { updateAdminPin, verifyAdminPin } from "@/lib/admin-settings";
import {
  getMonthScheduleOverrides,
  getMonthSchedulePauses,
  type MonthOverrideRow,
  type MonthPauseRow,
} from "@/lib/schedule-calendar";
import {
  createStudentPause,
  deleteStudentPause,
  listStudentPauses,
  listStudentPausesForMonth,
  updateStudentPauseEnd,
  type StudentPause,
  type StudentPauseResult,
} from "@/lib/student-pauses";
import {
  deleteStudentPaymentOverride,
  freezeStudentPaymentHistory,
  getProjectedPaymentDate,
  listStudentPaymentOverrides,
  setStudentPaymentOverride,
  type StudentPaymentOverride,
  type StudentPaymentOverrideResult,
} from "@/lib/student-payment-overrides";

const SESSION_COOKIE = "elan_admin_session";
const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
const PIN_RE = /^\d{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const paymentDayRaw = String(formData.get("paymentDay") ?? "").trim();
  const startDateRaw = String(formData.get("startDate") ?? "").trim();

  if (!name) {
    return { error: "이름을 입력해주세요." };
  }
  if (!PHONE_RE.test(parentPhone)) {
    return { error: "부모님 전화번호 형식을 확인해주세요. (예: 010-1234-5678)" };
  }
  if (!classDaysRaw.every(isDayKey)) {
    return { error: "요일 값이 올바르지 않습니다." };
  }

  const classDays = classDaysRaw as DayKey[];
  const classTimes: ClassTimes = {};
  for (const day of classDays) {
    const time = String(formData.get(`classTime_${day}`) ?? "").trim();
    if (!TIME_RE.test(time)) {
      return { error: `${DAY_LABELS[day]}요일 수업 시간을 입력해주세요.` };
    }
    classTimes[day] = time;
  }

  let age: number | null = null;
  if (ageRaw) {
    age = Number(ageRaw);
    if (!Number.isInteger(age) || age < 0 || age > 100) {
      return { error: "나이를 올바르게 입력해주세요." };
    }
  }

  let paymentDay: number | null = null;
  if (paymentDayRaw) {
    paymentDay = Number(paymentDayRaw);
    if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) {
      return { error: "결제일을 올바르게 입력해주세요." };
    }
  }

  let startDate: string;
  if (id) {
    const existing = await findStudentForEdit(id);
    if (!existing) {
      return { error: "학생 정보를 찾을 수 없습니다." };
    }
    // Once start_date has passed, it's locked — ignore whatever the form
    // submitted (the UI disables the field, but the server is the real
    // guard) and keep the existing value.
    if (existing.startDate <= todayKstDateStr()) {
      startDate = existing.startDate;
    } else {
      if (!DATE_RE.test(startDateRaw)) {
        return { error: "시작일을 올바르게 입력해주세요." };
      }
      startDate = startDateRaw;
    }
  } else {
    if (!DATE_RE.test(startDateRaw)) {
      return { error: "시작일을 올바르게 입력해주세요." };
    }
    startDate = startDateRaw;
  }

  const input = {
    name,
    age,
    parentPhone,
    memo,
    classDays,
    classTimes,
    paymentDay,
    startDate,
  };

  if (id) {
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

  if (result.ok) {
    const student = await findStudentById(studentId);
    if (student) {
      sendAdminAttendanceAlert({
        action: "check-out",
        studentName: student.name,
        parentPhone: student.parentPhone,
        timestamp: result.record.checkOutAt,
      });
    }
  }

  revalidatePath("/admin/dashboard");
  return { ok: result.ok };
}

export async function adminBulkCheckOutAction(studentIds: string[]): Promise<{ count: number }> {
  await requireAdminSession();

  const uniqueIds = Array.from(new Set(studentIds));
  const records = await adminBulkCheckOut(uniqueIds);

  if (records.length > 0) {
    const students = await findStudentsByIds(records.map((r) => r.studentId));
    const studentsById = new Map(students.map((s) => [s.id, s]));

    const alerts = records.flatMap((record) => {
      const student = studentsById.get(record.studentId);
      if (!student) return [];
      return [
        {
          action: "check-out" as const,
          studentName: student.name,
          parentPhone: student.parentPhone,
          timestamp: record.checkOutAt,
        },
      ];
    });
    await sendAdminAttendanceAlerts(alerts);
  }

  revalidatePath("/admin/dashboard");
  return { count: records.length };
}

export async function setAttendanceStatusAction(
  studentId: string,
  date: string,
  status: "present" | "absent" | "auto"
): Promise<Record<string, DayAttendanceInfo>> {
  await requireAdminSession();

  if (!DATE_RE.test(date)) {
    throw new Error("Invalid date");
  }

  const result =
    status === "auto"
      ? await clearAttendanceOverride(studentId, date)
      : await setAttendanceOverride(studentId, date, status);

  revalidatePath("/admin/dashboard");
  return result;
}

// Used when the day being reset to "기록없음" already has a real check-in —
// clearing just the override would leave that check-in behind and the day
// would keep reading back as "present". Only reachable after the admin
// confirms a warning in the UI, since this permanently deletes the check-in.
export async function clearAttendanceDayAction(
  studentId: string,
  date: string
): Promise<Record<string, DayAttendanceInfo>> {
  await requireAdminSession();

  if (!DATE_RE.test(date)) {
    throw new Error("Invalid date");
  }

  const result = await clearAttendanceDayRecords(studentId, date);
  revalidatePath("/admin/dashboard");
  return result;
}

export async function setAttendanceMakeupDateAction(
  studentId: string,
  date: string,
  makeupDate: string | null,
  makeupTime: string | null
): Promise<Record<string, DayAttendanceInfo>> {
  await requireAdminSession();

  if (!DATE_RE.test(date)) {
    throw new Error("Invalid date");
  }
  if (makeupDate !== null && !DATE_RE.test(makeupDate)) {
    throw new Error("Invalid makeup date");
  }
  if (makeupDate !== null && (makeupTime === null || !TIME_RE.test(makeupTime))) {
    throw new Error("Invalid makeup time");
  }

  const result = await setAttendanceMakeupDate(studentId, date, makeupDate, makeupDate === null ? null : makeupTime);
  revalidatePath("/admin/dashboard");
  return result;
}

export async function setAttendanceMakeupRequiredAction(
  studentId: string,
  date: string,
  makeupRequired: boolean
): Promise<Record<string, DayAttendanceInfo>> {
  await requireAdminSession();

  if (!DATE_RE.test(date)) {
    throw new Error("Invalid date");
  }

  const result = await setAttendanceMakeupRequired(studentId, date, makeupRequired);
  revalidatePath("/admin/dashboard");
  return result;
}

// The attendance calendar always needs all three of these together (initial
// load, month navigation, and after any pause mutation) — bundling them into
// one round trip instead of three separate server actions.
export async function getAttendanceCalendarDataAction(
  studentId: string,
  year: number,
  month: number,
  // The attendance page's server component already runs one catch-up freeze
  // before this client ever mounts, and a no-op freeze call still costs a
  // full round trip — so the calendar only pays for a second one on its
  // very first fetch (covering direct client-side entry points) and skips
  // it on every month-navigation refetch after that.
  skipFreeze = false
): Promise<{
  attendance: Record<string, DayAttendanceInfo>;
  pauses: StudentPause[];
  monthPauses: StudentPause[];
  paymentOverrides: StudentPaymentOverride[];
  projectedPaymentDate: string | null;
  nextMonthProjectedPaymentDate: string | null;
}> {
  await requireAdminSession();

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid year/month");
  }

  // Catches up any past, not-yet-recorded payment dates before reading them
  // back — regardless of which month is being viewed, so history never
  // falls behind. A no-op after the first call for a given day.
  if (!skipFreeze) {
    await freezeStudentPaymentHistory(studentId);
  }

  const [attendance, pauses, monthPauses, paymentOverrides] = await Promise.all([
    getStudentMonthAttendance(studentId, year, month),
    listStudentPauses(studentId),
    listStudentPausesForMonth(studentId, year, month),
    listStudentPaymentOverrides(studentId),
  ]);

  // The projection is only ever consulted when the viewed month has no
  // confirmed override yet (see resolvedPaymentDate in attendance-calendar.tsx)
  // — skip the extra round trip for the common case of a past or
  // already-set month, where its result would just be thrown away.
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
  const hasOverrideForMonth = paymentOverrides.some((o) => o.paymentDate.startsWith(monthPrefix));

  // Same projection, one month ahead — feeds the "다음 달 결제일" bubble next
  // to the calendar's forward-nav button, so a pause's delay is visible
  // before the admin even navigates there. Run alongside the current-month
  // projection (rather than after it) since neither depends on the other.
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthPrefix = `${nextYear}-${String(nextMonth).padStart(2, "0")}-`;
  const hasOverrideForNextMonth = paymentOverrides.some((o) => o.paymentDate.startsWith(nextMonthPrefix));

  const [projectedPaymentDate, nextMonthProjectedPaymentDate] = await Promise.all([
    hasOverrideForMonth ? null : getProjectedPaymentDate(studentId, year, month),
    hasOverrideForNextMonth ? null : getProjectedPaymentDate(studentId, nextYear, nextMonth),
  ]);

  return { attendance, pauses, monthPauses, paymentOverrides, projectedPaymentDate, nextMonthProjectedPaymentDate };
}

export async function createStudentPauseAction(
  studentId: string,
  pausedFrom: string,
  pausedUntil: string
): Promise<StudentPauseResult> {
  await requireAdminSession();
  const result = await createStudentPause(studentId, pausedFrom, pausedUntil);
  revalidatePath(`/admin/dashboard/students/${studentId}/attendance`);
  revalidatePath("/admin/dashboard");
  return result;
}

export async function updateStudentPauseEndAction(
  studentId: string,
  pauseId: string,
  pausedUntil: string
): Promise<StudentPauseResult> {
  await requireAdminSession();
  const result = await updateStudentPauseEnd(studentId, pauseId, pausedUntil);
  revalidatePath(`/admin/dashboard/students/${studentId}/attendance`);
  revalidatePath("/admin/dashboard");
  return result;
}

export async function deleteStudentPauseAction(studentId: string, pauseId: string): Promise<void> {
  await requireAdminSession();
  await deleteStudentPause(studentId, pauseId);
  revalidatePath(`/admin/dashboard/students/${studentId}/attendance`);
  revalidatePath("/admin/dashboard");
}

export async function setStudentPaymentOverrideAction(
  studentId: string,
  year: number,
  month: number,
  paymentDate: string
): Promise<StudentPaymentOverrideResult> {
  await requireAdminSession();
  const result = await setStudentPaymentOverride(studentId, year, month, paymentDate);
  revalidatePath(`/admin/dashboard/students/${studentId}/attendance`);
  revalidatePath("/admin/dashboard");
  return result;
}

export async function deleteStudentPaymentOverrideAction(studentId: string, overrideId: string): Promise<void> {
  await requireAdminSession();
  await deleteStudentPaymentOverride(studentId, overrideId);
  revalidatePath(`/admin/dashboard/students/${studentId}/attendance`);
  revalidatePath("/admin/dashboard");
}

export async function getScheduleMonthOverridesAction(year: number, month: number): Promise<MonthOverrideRow[]> {
  await requireAdminSession();

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid year/month");
  }

  return getMonthScheduleOverrides(year, month);
}

export async function getScheduleMonthPausesAction(year: number, month: number): Promise<MonthPauseRow[]> {
  await requireAdminSession();

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid year/month");
  }

  return getMonthSchedulePauses(year, month);
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
