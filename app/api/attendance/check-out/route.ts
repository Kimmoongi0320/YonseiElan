import { NextResponse } from "next/server";
import { findStudentById } from "@/lib/students";
import { checkOut, getActiveRecord } from "@/lib/attendance";

export async function POST(request: Request) {
  const { studentId } = await request.json();

  if (typeof studentId !== "string") {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  // Independent reads on different tables — run them together instead of
  // sequentially. The update inside checkOut() still waits on both results.
  const [student, active] = await Promise.all([findStudentById(studentId), getActiveRecord(studentId)]);

  if (!student) {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  const result = await checkOut(studentId, active);
  if (!result.ok) {
    if (result.reason === "too-early") {
      return NextResponse.json(
        { ok: false, reason: result.reason, remainingMs: result.remainingMs },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 409 });
  }

  return NextResponse.json({ ok: true, checkOutAt: result.record.checkOutAt });
}
