// GET /api/photos?estimateId=EST-10002
// The job photos that belong to this quote, grouped by round, plus Needs you cards.
import { NextResponse } from "next/server";
import { loadForEstimate } from "@/lib/photo_loader/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const estimateId = (url.searchParams.get("estimateId") || "").trim();
  if (!estimateId) return NextResponse.json({ error: "missing_estimate_id" }, { status: 400 });
  const session = await getSession();
  if (session && session.role !== "admin") {
    const row = await prisma.estimate.findUnique({ where: { id: estimateId }, select: { userId: true } });
    if (row && row.userId !== session.uid) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await loadForEstimate(estimateId);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
