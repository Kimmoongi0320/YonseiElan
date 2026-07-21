import { NextResponse } from "next/server";
import { findStudentById } from "@/lib/students";
import { getActiveRecord } from "@/lib/attendance";
import { CHECK_OUT_WAIT_MS } from "@/lib/constants";

export async function GET(request: Request) {
  const studentId = new URL(request.url).searchParams.get("studentId");

  if (!studentId) {
    return NextResponse.json({ checkedIn: false }, { status: 404 });
  }

  const [student, record] = await Promise.all([
    findStudentById(studentId),
    getActiveRecord(studentId),
  ]);

  if (!student) {
    return NextResponse.json({ checkedIn: false }, { status: 404 });
  }
  if (!record) {
    return NextResponse.json({ checkedIn: false });
  }

  const remainingMs = Math.max(0, CHECK_OUT_WAIT_MS - (Date.now() - record.checkInAt));
  return NextResponse.json({
    checkedIn: true,
    checkInAt: record.checkInAt,
    canCheckOut: remainingMs === 0,
    remainingMs,
  });
}
