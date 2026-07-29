import { NextResponse } from "next/server";
import { undoCheckIn, undoCheckOut } from "@/lib/attendance";

export async function POST(request: Request) {
  const { recordId, studentId, action } = await request.json();

  if (
    typeof recordId !== "string" ||
    typeof studentId !== "string" ||
    (action !== "check-in" && action !== "check-out")
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (action === "check-in") {
    await undoCheckIn(recordId, studentId);
  } else {
    await undoCheckOut(recordId, studentId);
  }

  return NextResponse.json({ ok: true });
}
