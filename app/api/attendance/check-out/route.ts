import { NextResponse } from "next/server";
import { findStudentById } from "@/lib/students";
import { checkOut } from "@/lib/attendance";

export async function POST(request: Request) {
  const { studentId } = await request.json();

  if (typeof studentId !== "string" || !(await findStudentById(studentId))) {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  const result = await checkOut(studentId);
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
