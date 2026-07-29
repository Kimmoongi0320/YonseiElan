import { NextResponse } from "next/server";
import { findStudentsByPhone } from "@/lib/students";
import { sortDayKeys } from "@/lib/schedule";

export async function POST(request: Request) {
  const { phone } = await request.json();

  if (typeof phone !== "string" || !/^\d{4}$/.test(phone)) {
    return NextResponse.json({ students: [] }, { status: 400 });
  }

  const found = await findStudentsByPhone(phone);
  const students = found.map((s) => ({
    id: s.id,
    name: s.name,
    age: s.age,
    classDays: sortDayKeys(s.classDays),
  }));
  return NextResponse.json({ students });
}
