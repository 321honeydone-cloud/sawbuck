import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rowFromEstimate } from "@/lib/serialize";
import { issuesToEstimate } from "@/lib/scout";
import type { Estimate, InspectionIssue } from "@/lib/types";

export const runtime = "nodejs";

function blankEstimate(id: string, name: string): Estimate {
  return {
    id,
    projectId: `PRJ-${id.replace(/^EST-/, "")}`,
    name,
    status: "draft",
    location: "Florida",
    markupDefault: 25,
    finishLevel: "medium",
    aiUpdateCount: 0,
    groups: [],
    totals: { totalCost: 0, totalMarkup: 0, estimateTotal: 0, profitMargin: 0 },
  };
}

async function nextEstimateId(): Promise<string> {
  const rows = await prisma.estimate.findMany({ select: { id: true } });
  let max = 10001;
  for (const { id } of rows) {
    const n = Number(id.replace(/^EST-/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `EST-${max + 1}`;
}

// POST /api/inspection/convert { id } — build a priced estimate from an inspection.
export async function POST(req: Request) {
  const session = await getSession();
  let insId = "";
  try {
    insId = String(((await req.json()) as { id?: string }).id ?? "");
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!insId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const ins = await prisma.inspection.findUnique({ where: { id: insId } });
  if (!ins) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let issues: InspectionIssue[] = [];
  try {
    issues = (JSON.parse(ins.data || "{}").issues ?? []) as InspectionIssue[];
  } catch {
    issues = [];
  }
  issues = issues.filter((i) => i.include !== false);
  if (issues.length === 0) return NextResponse.json({ error: "no_issues" }, { status: 400 });

  const id = await nextEstimateId();
  const built = issuesToEstimate(blankEstimate(id, ins.name), issues);
  const row = rowFromEstimate(built);
  await prisma.estimate.create({
    data: {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      status: row.status,
      location: row.location,
      markupDefault: row.markupDefault,
      finishLevel: row.finishLevel,
      aiUpdateCount: row.aiUpdateCount,
      userId: ins.userId ?? session?.uid ?? null,
      data: row.data,
    },
  });
  await prisma.chatMessage.create({
    data: {
      estimateId: id,
      role: "ai",
      content: `Built from inspection ${ins.id}. ${issues.length} issue${issues.length === 1 ? "" : "s"} brought in as line items, grouped by trade. Price the materials and adjust labor, then generate the Jobber quote.`,
    },
  });
  return NextResponse.json({ id }, { status: 201 });
}
