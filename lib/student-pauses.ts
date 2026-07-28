import { getSupabaseServerClient } from "./supabase/server";

export type StudentPause = {
  id: string;
  studentId: string;
  pausedFrom: string;
  pausedUntil: string;
};

export type StudentPauseResult = { error: string } | { pause: StudentPause };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// The UTC instant that KST midnight falls on, for the given KST calendar date.
function kstMidnightIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS).toISOString();
}

function nextDateStr(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toStudentPause(row: { id: string; student_id: string; paused_from: string; paused_until: string }): StudentPause {
  return { id: row.id, studentId: row.student_id, pausedFrom: row.paused_from, pausedUntil: row.paused_until };
}

export async function listStudentPauses(studentId: string): Promise<StudentPause[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_pauses")
    .select("id, student_id, paused_from, paused_until")
    .eq("student_id", studentId)
    .order("paused_from", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toStudentPause);
}

// Scoped to pauses that overlap the given calendar month at all (a pause can
// start in one month and end in a later one), for the attendance calendar
// grid — which only ever needs to know about the month it's displaying,
// unlike the pause-management panel's own listStudentPauses call above.
export async function listStudentPausesForMonth(
  studentId: string,
  year: number,
  month: number
): Promise<StudentPause[]> {
  const startDate = `${year}-${pad2(month)}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStart = `${nextYear}-${pad2(nextMonth)}-01`;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_pauses")
    .select("id, student_id, paused_from, paused_until")
    .eq("student_id", studentId)
    .lt("paused_from", nextMonthStart)
    .gte("paused_until", startDate)
    .order("paused_from", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toStudentPause);
}

// Shared by createStudentPause and updateStudentPauseEnd: rejects a range
// that would swallow a real check-in (the student actually attended, so the
// pause can't retroactively pretend that day didn't happen), then clears
// whatever the range would otherwise leave dangling — attendance overrides
// dated inside it (both the delete and the makeup they may have carried),
// and makeup dates pointing into it from absences dated outside it.
async function validateAndCleanRange(
  studentId: string,
  pausedFrom: string,
  pausedUntil: string,
  excludePauseId?: string
): Promise<string | null> {
  const supabase = getSupabaseServerClient();

  let overlapQuery = supabase
    .from("student_pauses")
    .select("id")
    .eq("student_id", studentId)
    .lte("paused_from", pausedUntil)
    .gte("paused_until", pausedFrom);
  if (excludePauseId) overlapQuery = overlapQuery.neq("id", excludePauseId);

  const [{ data: overlapping, error: overlapError }, { data: checkins, error: checkinsError }] = await Promise.all([
    overlapQuery,
    supabase
      .from("attendance_records")
      .select("check_in_at")
      .eq("student_id", studentId)
      .gte("check_in_at", kstMidnightIso(pausedFrom))
      .lt("check_in_at", kstMidnightIso(nextDateStr(pausedUntil))),
  ]);

  if (overlapError) throw overlapError;
  if (checkinsError) throw checkinsError;

  if ((overlapping ?? []).length > 0) {
    return "이미 등록된 다른 정지 기간과 겹칩니다.";
  }
  if ((checkins ?? []).length > 0) {
    return "이 기간에 실제 출석 기록이 있어 정지로 등록할 수 없습니다. 먼저 해당 날짜의 출석 기록을 확인해주세요.";
  }

  const { error: deleteError } = await supabase
    .from("attendance_overrides")
    .delete()
    .eq("student_id", studentId)
    .gte("date", pausedFrom)
    .lte("date", pausedUntil);
  if (deleteError) throw deleteError;

  const { error: clearMakeupError } = await supabase
    .from("attendance_overrides")
    .update({ makeup_date: null, makeup_time: null })
    .eq("student_id", studentId)
    .gte("makeup_date", pausedFrom)
    .lte("makeup_date", pausedUntil);
  if (clearMakeupError) throw clearMakeupError;

  return null;
}

export async function createStudentPause(
  studentId: string,
  pausedFrom: string,
  pausedUntil: string
): Promise<StudentPauseResult> {
  if (!DATE_RE.test(pausedFrom) || !DATE_RE.test(pausedUntil)) return { error: "날짜 형식이 올바르지 않습니다." };
  if (pausedUntil < pausedFrom) return { error: "재개일은 시작일 이후여야 합니다." };

  const validationError = await validateAndCleanRange(studentId, pausedFrom, pausedUntil);
  if (validationError) return { error: validationError };

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_pauses")
    .insert({ student_id: studentId, paused_from: pausedFrom, paused_until: pausedUntil })
    .select("id, student_id, paused_from, paused_until")
    .single();

  if (error) throw error;
  return { pause: toStudentPause(data) };
}

// Edits only the resume date (paused_until) of an existing pause — covers
// both extending it (the student still hasn't returned) and shortening it
// (the student came back earlier than planned).
export async function updateStudentPauseEnd(
  studentId: string,
  pauseId: string,
  pausedUntil: string
): Promise<StudentPauseResult> {
  if (!DATE_RE.test(pausedUntil)) return { error: "날짜 형식이 올바르지 않습니다." };

  const supabase = getSupabaseServerClient();
  const { data: existing, error: existingError } = await supabase
    .from("student_pauses")
    .select("id, student_id, paused_from, paused_until")
    .eq("id", pauseId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return { error: "정지 기록을 찾을 수 없습니다." };
  if (pausedUntil < existing.paused_from) return { error: "재개일은 시작일 이후여야 합니다." };

  const validationError = await validateAndCleanRange(studentId, existing.paused_from, pausedUntil, pauseId);
  if (validationError) return { error: validationError };

  const { data, error } = await supabase
    .from("student_pauses")
    .update({ paused_until: pausedUntil })
    .eq("id", pauseId)
    .select("id, student_id, paused_from, paused_until")
    .single();

  if (error) throw error;
  return { pause: toStudentPause(data) };
}

export async function deleteStudentPause(studentId: string, pauseId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("student_pauses").delete().eq("id", pauseId).eq("student_id", studentId);
  if (error) throw error;
}
