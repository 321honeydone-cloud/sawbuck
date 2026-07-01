import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rowFromEstimate } from "@/lib/serialize";
import { getSession } from "@/lib/session";
import type { Estimate } from "@/lib/types";

export const runtime = "nodejs";

/** Next available EST-#### id, derived from the highest existing numeric suffix. */
async function nextEstimateId(): Promise<string> {
  const rows = await prisma.estimate.findMany({ select: { id: true } });
  let max = 10001; // seed estimate is EST-10002
  for (const { id } of rows) {
    const n = Number(id.replace(/^EST-/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `EST-${max + 1}`;
}

// GET /api/estimate — list the signed-in user's quotes for the sidebar (admin sees all).
export async function GET() {
  const session = await getSession();
  const where = session && session.role !== "admin" ? { userId: session.uid } : {};
  const estimates = await prisma.estimate.findMany({
    where,
    select: { id: true, name: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ estimates });
}

// POST /api/estimate — create a blank draft estimate; returns { id, name }.
export async function POST(req: Request) {
  let body: { name?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — use defaults
  }
  const session = await getSession();
  const uid = session?.uid ?? null;

  // Reuse the user's most recent empty draft instead of piling up blanks.
  if (uid) {
    const recent = await prisma.estimate.findFirst({
      where: { userId: uid },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, data: true, status: true },
    });
    if (recent && recent.status === "draft") {
      let empty = true;
      try {
        const p = JSON.parse(recent.data || "{}") as { groups?: unknown[] };
        empty = !p.groups || p.groups.length === 0;
      } catch {
        empty = true;
      }
      if (empty) return NextResponse.json({ id: recent.id, name: recent.name }, { status: 200 });
    }
  }

  const id = await nextEstimateId();
  const name = (body.name?.trim() || "New Estimate").slice(0, 120);

  await prisma.estimate.create({
    data: {
      id,
      projectId: `PRJ-${id.replace(/^EST-/, "")}`,
      name,
      status: "draft",
      userId: uid,
      location: "Florida",
      markupDefault: 25,
      finishLevel: "medium",
      aiUpdateCount: 0,
      data: JSON.stringify({
        groups: [],
        totals: { totalCost: 0, totalMarkup: 0, estimateTotal: 0, profitMargin: 0 },
      }),
    },
  });

  await prisma.chatMessage.create({
    data: {
      estimateId: id,
      role: "ai",
      content:
        "New estimate started. Tell me the job, for example \"fascia and rot repair, about 24 feet\", and I will build it out at your pricing.",
    },
  });

  return NextResponse.json({ id, name }, { status: 201 });
}

// PUT /api/estimate — persist the full estimate (scalar columns + JSON blob).
export async function PUT(req: Request) {
  let estimate: Estimate;
  try {
    estimate = (await req.json()) as Estimate;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!estimate?.id) {
    return NextResponse.json({ error: "missing estimate id" }, { status: 400 });
  }

  const row = rowFromEstimate(estimate);
  await prisma.estimate.update({
    where: { id: row.id },
    data: {
      name: row.name,
      status: row.status,
      location: row.location,
      markupDefault: row.markupDefault,
      finishLevel: row.finishLevel,
      aiUpdateCount: row.aiUpdateCount,
      data: row.data,
    },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/estimate { id } — remove a quote (cascades its chat). A user can
// only delete their own; an admin can delete any.
export async function DELETE(req: Request) {
  const session = await getSession();
  let id = "";
  try {
    id = String(((await req.json()) as { id?: string }).id ?? "");
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const row = await prisma.estimate.findUnique({ where: { id }, select: { userId: true } });
  if (!row) return NextResponse.json({ ok: true });
  if (session && session.role !== "admin" && row.userId !== session.uid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await prisma.estimate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
