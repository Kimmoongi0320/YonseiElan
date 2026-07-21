import { NextResponse } from "next/server";
import { findStudentsByPhone } from "@/lib/students";

export async function POST(request: Request) {
  const { phone } = await request.json();

  if (typeof phone !== "string" || !/^\d{4}$/.test(phone)) {
    return NextResponse.json({ students: [] }, { status: 400 });
  }

  const found = await findStudentsByPhone(phone);
  const students = found.map((s) => ({ id: s.id, name: s.name }));
  return NextResponse.json({ students });
}
