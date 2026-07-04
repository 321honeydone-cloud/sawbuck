// AI gist of a quote's conversation, for the admin. Lazy and admin-only so it
// only costs a call when the owner actually asks for it.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { chatText } from "@/lib/agents/client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let estimateId = "";
  try {
    estimateId = String(((await req.json()) as { estimateId?: string }).estimateId ?? "");
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!estimateId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const row = await prisma.estimate.findUnique({
    where: { id: estimateId },
    include: { messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true } } },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const tx = (row.messages ?? [])
    .filter((m: { role: string }) => m.role !== "system")
    .map((m: { role: string; content: string }) => `${m.role === "ai" ? "AI" : "Customer"}: ${m.content}`)
    .join("\n")
    .slice(0, 6000);
  if (!tx.trim()) return NextResponse.json({ summary: "No conversation to summarize on this quote." });

  let summary = "";
  try {
    summary = await chatText({
      system:
        "You summarize a contractor's quote conversation for the shop owner in 1 to 2 short sentences. Say what the job was, the main thing the customer wanted, whether they pushed back on price, and roughly how many changes were made. No em dashes and no semicolons.",
      prompt: tx,
      temperature: 0.3,
      // A summary is a nicety, never worth a multi-minute wait on a busy local
      // model. Fail fast and show "could not summarize" instead.
      timeoutMs: 45000,
    });
  } catch {
    summary = "Could not summarize right now.";
  }
  return NextResponse.json({ summary: summary.trim() || "No summary available." });
}
