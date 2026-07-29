import { NextResponse } from "next/server";
import { findStudentById } from "@/lib/students";
import { getAlreadyCompletedToday, getOpenRecord, resolveAttendance } from "@/lib/attendance";

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

  return NextResponse.json(result);
}
