import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// GET /api/auth/me — who is signed in (name + role), for the menu.
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ uid: s.uid, name: s.name, role: s.role });
}
