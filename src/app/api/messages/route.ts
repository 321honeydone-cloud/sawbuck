// Persist chat turns so the conversation survives a reload and the admin can
// read the transcript later. The chat stream route does not save anything, so
// the client posts the user message and the finished AI message here after each
// turn. meta carries the AI extras (trace, crew, summary) as JSON.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const ROLES = new Set(["user", "ai", "system"]);

// POST /api/messages { estimateId, messages: [{ role, content, meta? }] }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { estimateId?: string; messages?: { role?: string; content?: string; meta?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const estimateId = String(body.estimateId ?? "");
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  if (!estimateId || msgs.length === 0) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  // Ownership: a non-admin can only write to their own estimate.
  const row = await prisma.estimate.findUnique({ where: { id: estimateId }, select: { userId: true } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (session.role !== "admin" && row.userId && row.userId !== session.uid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let saved = 0;
  for (const m of msgs) {
    const role = String(m.role ?? "");
    const content = String(m.content ?? "");
    const meta = m.meta ? String(m.meta) : null;
    if (!ROLES.has(role)) continue;
    if (!content && !meta) continue;
    await prisma.chatMessage.create({ data: { estimateId, role, content, meta } });
    saved++;
  }
  return NextResponse.json({ ok: true, saved });
}
