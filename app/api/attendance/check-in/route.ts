import { NextResponse } from "next/server";
import { findStudentById } from "@/lib/students";
import { checkIn, getOpenRecord } from "@/lib/attendance";

export async function POST(request: Request) {
  const { studentId } = await request.json();

  if (typeof studentId !== "string") {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  // Independent reads on different tables — run them together instead of
  // sequentially. The insert inside checkIn() still waits on both results.
  const [student, open] = await Promise.all([findStudentById(studentId), getOpenRecord(studentId)]);

  if (!student) {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  const result = await checkIn(studentId, open);
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json({ ok: true, checkInAt: result.record.checkInAt });
}
