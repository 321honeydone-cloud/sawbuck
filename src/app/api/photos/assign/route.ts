// POST /api/photos/assign { roundKey, quoteId, role? }   pick the quote for a round
// DELETE /api/photos/assign { roundKey }                  undo a pick
import { NextResponse } from "next/server";
import { clearAssignment, writeAssignment } from "@/lib/photo_loader/server";
import type { RoundRole } from "@/lib/photo_loader/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { roundKey?: string; quoteId?: string; role?: RoundRole | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.roundKey || !body.quoteId) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  const role = body.role === "Before" || body.role === "Progress" || body.role === "After" ? body.role : null;
  await writeAssignment(body.roundKey, body.quoteId, role);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let body: { roundKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.roundKey) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  await clearAssignment(body.roundKey);
  return NextResponse.json({ ok: true });
}
