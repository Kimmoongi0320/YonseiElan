import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminPin } from "@/lib/admin-settings";

const SESSION_COOKIE = "elan_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 8;

export async function POST(request: Request) {
  const { pin } = await request.json();

  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!(await verifyAdminPin(pin))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
