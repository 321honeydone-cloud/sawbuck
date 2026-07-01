// Open email sign-up. Anyone can create an account with an email and password,
// which logs them straight in as a regular user. The owner/admin stays the
// APP_PINS bootstrap login. Passwords are stored as a PBKDF2 hash, never plain.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { COOKIE_NAME, hashPassword, signSession, type Session } from "@/lib/auth";

export const runtime = "nodejs";

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// POST /api/auth/signup { name?, email, password }
export async function POST(req: Request) {
  let body: { name?: string; email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim() || email.split("@")[0];
  if (!EMAIL_RX.test(email)) return NextResponse.json({ error: "bad_email" }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "weak_password" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "email_taken" }, { status: 409 });

  const passHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { name, email, passHash, role: "user" } });

  const session: Session = { uid: user.id, name: user.name, role: "user" };
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
