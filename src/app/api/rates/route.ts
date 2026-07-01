import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  RATEBOOK_ID,
  RATEBOOK_NAME,
  isLearnable,
  mergeRate,
  parseRateBook,
  type RateBookItem,
  type RateInput,
} from "@/lib/rates";
import type { CostType, Unit } from "@/lib/types";

export const runtime = "nodejs";

async function loadItems(): Promise<RateBookItem[]> {
  const row = await prisma.catalog.findUnique({ where: { id: RATEBOOK_ID } });
  return parseRateBook(row?.items);
}

async function saveItems(items: RateBookItem[]) {
  const data = JSON.stringify(items);
  await prisma.catalog.upsert({
    where: { id: RATEBOOK_ID },
    update: { items: data },
    create: { id: RATEBOOK_ID, name: RATEBOOK_NAME, type: "mixed", items: data },
  });
}

// GET /api/rates — the current rate book (most-used first).
export async function GET() {
  const items = await loadItems();
  items.sort((a, b) => b.useCount - a.useCount);
  return NextResponse.json({ items });
}

// POST /api/rates — fold one edited/created line item into the rate book.
export async function POST(req: Request) {
  let body: Partial<RateInput>;
  try {
    body = (await req.json()) as Partial<RateInput>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isLearnable({ name: body.name, unitCost: body.unitCost })) {
    return NextResponse.json({ ok: false, skipped: true });
  }

  const input: RateInput = {
    name: String(body.name),
    unit: body.unit as Unit,
    costType: body.costType as CostType,
    unitCost: Number(body.unitCost),
    supplier: body.supplier ?? null,
    source: body.source ?? "manual",
  };

  const merged = mergeRate(await loadItems(), input);
  await saveItems(merged);
  return NextResponse.json({ ok: true, count: merged.length });
}
