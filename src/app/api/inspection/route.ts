import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { Inspection, InspectionIssue } from "@/lib/types";

export const runtime = "nodejs";

async function nextId(): Promise<string> {
  const rows = await prisma.inspection.findMany({ select: { id: true } });
  let max = 10000;
  for (const { id } of rows) {
    const n = Number(id.replace(/^INS-/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `INS-${max + 1}`;
}

function issuesOf(data: string): InspectionIssue[] {
  try {
    return (JSON.parse(data || "{}").issues ?? []) as InspectionIssue[];
  } catch {
    return [];
  }
}

// GET — list inspections (admin sees all, user sees own)
export async function GET() {
  const session = await getSession();
  const where = session && session.role !== "admin" ? { userId: session.uid } : {};
  const rows = await prisma.inspection.findMany({ where, orderBy: { updatedAt: "desc" }, take: 100 });
  const inspections = rows.map((r) => ({
    id: r.id,
    name: r.name,
    location: r.location,
    status: r.status,
    issueCount: issuesOf(r.data).length,
    updatedAt: r.updatedAt,
  }));
  return NextResponse.json({ inspections });
}

// POST — create a blank inspection, reusing a recent empty one to avoid blanks
export async function POST() {
  const session = await getSession();
  const uid = session?.uid ?? null;
  if (uid) {
    const recent = await prisma.inspection.findFirst({
      where: { userId: uid },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, data: true, status: true },
    });
    if (recent && recent.status === "open" && issuesOf(recent.data).length === 0) {
      return NextResponse.json({ id: recent.id, name: recent.name }, { status: 200 });
    }
  }
  const id = await nextId();
  const name = "New Inspection";
  await prisma.inspection.create({ data: { id, name, userId: uid, status: "open", data: JSON.stringify({ issues: [] }) } });
  return NextResponse.json({ id, name }, { status: 201 });
}

// PUT — save the whole inspection
export async function PUT(req: Request) {
  let ins: Inspection;
  try {
    ins = (await req.json()) as Inspection;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!ins?.id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await prisma.inspection.update({
    where: { id: ins.id },
    data: {
      name: ins.name,
      location: ins.location ?? null,
      status: ins.status ?? "open",
      data: JSON.stringify({ issues: ins.issues ?? [] }),
    },
  });
  return NextResponse.json({ ok: true });
}

// DELETE — remove an inspection (owner-scoped)
export async function DELETE(req: Request) {
  const session = await getSession();
  let id = "";
  try {
    id = String(((await req.json()) as { id?: string }).id ?? "");
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const row = await prisma.inspection.findUnique({ where: { id }, select: { userId: true } });
  if (!row) return NextResponse.json({ ok: true });
  if (session && session.role !== "admin" && row.userId !== session.uid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await prisma.inspection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
