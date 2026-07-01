import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { COOKIE_NAME, getPins, hashPin, verifyPassword, signSession, type Session } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/auth/login
//   { email, password }  log in to an email account
//   { pin }              log in by crew PIN, or as the APP_PINS bootstrap owner
export async function POST(req: Request) {
  let body: { email?: string; password?: string; pin?: string | number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const pin = String(body.pin ?? "").trim();

  let session: Session | null = null;

  if (email && password) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && (await verifyPassword(password, user.passHash))) {
      session = { uid: user.id, name: user.name, role: user.role === "admin" ? "admin" : "user" };
    }
    if (!session) return NextResponse.json({ error: "bad_login" }, { status: 401 });
  } else if (pin) {
    // Real user by PIN hash.
    try {
      const ph = await hashPin(pin);
      const user = await prisma.user.findUnique({ where: { pinHash: ph } });
      if (user) session = { uid: user.id, name: user.name, role: user.role === "admin" ? "admin" : "user" };
    } catch {
      /* user table may not exist yet before migration, fall through to bootstrap */
    }
    // Bootstrap owner via APP_PINS.
    if (!session && getPins().includes(pin)) {
      session = { uid: "owner", name: "Owner", role: "admin" };
    }
    if (!session) return NextResponse.json({ error: "bad_pin" }, { status: 401 });
  } else {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, role: session.role, name: session.name });
  res.cookies.set(COOKIE_NAME, await signSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
