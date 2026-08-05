import { after } from "next/server";
import { sendKakaoAlert } from "./kakao-alert";
import { recordExists, isCheckedOut, type AttendanceAction } from "./attendance";
import { ATTENDANCE_UNDO_WINDOW_MS } from "./constants";
import { formatDateTime } from "./format";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// Each template is registered separately in the Kakao business channel, but
// both reuse the same #{학생명}/#{등원일시} variable slots.
const TEMPLATE_ID_ENV: Record<AttendanceAction, string> = {
  "check-in": "KAKAO_ARRIVAL_TEMPLATE_ID",
  "check-out": "KAKAO_DEPARTURE_TEMPLATE_ID",
};

type AttendanceAlertParams = {
  action: AttendanceAction;
  studentName: string;
  parentPhone: string;
  timestamp: number;
};

async function sendAttendanceAlert({ action, studentName, parentPhone, timestamp }: AttendanceAlertParams): Promise<void> {
  await sendKakaoAlert({
    to: parentPhone.replace(/\D/g, ""),
    from: requireEnv("KAKAO_SENDER_PHONE"),
    pfId: requireEnv("KAKAO_PF_ID"),
    templateId: requireEnv(TEMPLATE_ID_ENV[action]),
    variables: {
      "#{학생명}": studentName,
      "#{등원일시}": formatDateTime(timestamp),
    },
  });
}

type ScheduleAttendanceAlertParams = AttendanceAlertParams & { recordId: string; studentId: string };

// Kiosk-only: waits out the kiosk's undo window before sending, so a "취소"
// tap in that window (which reverts the record via undoCheckIn/undoCheckOut)
// is enough to suppress the alert — no separate cancellation signal needed.
// Scheduled via `after()` rather than a bare setTimeout so the response can
// return immediately while the platform (e.g. Vercel's waitUntil) still keeps
// the invocation alive for the full delay instead of freezing it early.
export function scheduleAttendanceAlert({
  action,
  recordId,
  studentId,
  studentName,
  parentPhone,
  timestamp,
}: ScheduleAttendanceAlertParams): void {
  after(async () => {
    try {
      await sleep(ATTENDANCE_UNDO_WINDOW_MS);

      const stillStands =
        action === "check-in" ? await recordExists(recordId, studentId) : await isCheckedOut(recordId, studentId);
      if (!stillStands) return;

      await sendAttendanceAlert({ action, studentName, parentPhone, timestamp });
    } catch (error) {
      console.error(`Failed to send ${action} Kakao alert`, error);
    }
  });
}

// Admin-triggered check-in/check-out (dashboard "하원 처리", calendar "출석으로
// 표시") has no undo affordance, so the alert fires immediately instead of
// waiting out the kiosk's cancel window. Scheduled via `after()`, same
// reasoning as scheduleAttendanceAlert above — a delivery failure shouldn't
// fail the admin's action, but the send still needs to survive past the
// point where the server action's response is returned.
export function sendAdminAttendanceAlert(params: AttendanceAlertParams): void {
  after(() =>
    sendAttendanceAlert(params).catch((error) => {
      console.error(`Failed to send admin-triggered ${params.action} Kakao alert`, error);
    })
  );
}

// Bulk counterpart for the dashboard's "전체 하원 처리". Unlike
// sendAdminAttendanceAlert, this is awaited by the caller: all sends are
// still dispatched together (Promise.allSettled, not one-by-one), but on
// serverless hosting a fire-and-forget promise can get frozen mid-flight the
// moment the server action returns, silently dropping the alert. One
// student's failure doesn't affect the others.
export async function sendAdminAttendanceAlerts(paramsList: AttendanceAlertParams[]): Promise<void> {
  const results = await Promise.allSettled(paramsList.map((params) => sendAttendanceAlert(params)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`Failed to send admin-triggered ${paramsList[i].action} Kakao alert`, result.reason);
    }
  });
}
