import { NextResponse } from "next/server";
import { findStudentById } from "@/lib/students";
import { getAlreadyCompletedToday, getOpenRecord, resolveAttendance } from "@/lib/attendance";
import { scheduleAttendanceAlert } from "@/lib/attendance-alert";

export async function POST(request: Request) {
  const { studentId } = await request.json();

  if (typeof studentId !== "string") {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  const [student, open, alreadyCompletedToday] = await Promise.all([
    findStudentById(studentId),
    getOpenRecord(studentId),
    getAlreadyCompletedToday(studentId),
  ]);

  if (!student) {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  const result = await resolveAttendance(studentId, open, alreadyCompletedToday);
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }

  scheduleAttendanceAlert({
    action: result.action,
    recordId: result.record.id,
    studentId,
    studentName: student.name,
    parentPhone: student.parentPhone,
    timestamp: result.action === "check-in" ? result.record.checkInAt : result.record.checkOutAt,
  });

  return NextResponse.json(result);
}
