import { NextResponse } from "next/server";
import { findStudentById } from "@/lib/students";
import { checkIn } from "@/lib/attendance";

export async function POST(request: Request) {
  const { studentId } = await request.json();

  if (typeof studentId !== "string" || !(await findStudentById(studentId))) {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  const result = await checkIn(studentId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 409 });
  }

  return NextResponse.json({ ok: true, checkInAt: result.record.checkInAt });
}
