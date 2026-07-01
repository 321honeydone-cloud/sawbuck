import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateBook } from "@/lib/loadRateBook";
import {
  OVERRIDES_ID,
  OVERRIDES_NAME,
  applyOverrides,
  isPriced,
  parseOverrides,
  rateBookCounts,
  type OverrideMap,
  type RateOverride,
} from "@/lib/rateOverrides";

export const runtime = "nodejs";

async function requireAdmin() {
  const s = await getSession();
  return s && s.role === "admin" ? s : null;
}

async function loadOverrides(): Promise<OverrideMap> {
  const row = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
  return parseOverrides(row?.items);
}

async function saveOverrides(map: OverrideMap) {
  const data = JSON.stringify(map);
  await prisma.catalog.upsert({
    where: { id: OVERRIDES_ID },
    update: { items: data },
    create: { id: OVERRIDES_ID, name: OVERRIDES_NAME, type: "mixed", items: data },
  });
}

function countsFrom(overrides: OverrideMap) {
  const merged = applyOverrides(rateBook.tasks, overrides);
  return rateBookCounts(merged, overrides);
}

// GET /api/ratebook — the override map + progress counts. The client already
// has the static base book in its bundle, so we ship only the small overrides
// layer and let it merge for display (keeps the 416KB base off the wire).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const overrides = await loadOverrides();
  return NextResponse.json({ overrides, counts: countsFrom(overrides) });
}

// POST /api/ratebook — save one edited/priced task. Body fields are the
// editable rate-book columns. Pricing a stub (final_price > 0) clears its
// needs_price flag automatically via applyOverrides on the read side.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: Partial<RateOverride>;
  try {
    body = (await req.json()) as Partial<RateOverride>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });

  const baseNames = new Set(rateBook.tasks.map((t) => t.name));
  const isNew = !baseNames.has(name);

  const price = body.final_price;
  const final_price =
    price === null || price === undefined || price === ("" as unknown)
      ? null
      : Number(price);
  if (final_price !== null && (!isFinite(final_price) || final_price < 0)) {
    return NextResponse.json({ error: "bad_price" }, { status: 400 });
  }

  const num = (v: unknown): number | null | undefined => {
    if (v === null) return null;
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return isFinite(n) ? n : undefined;
  };

  const overrides = await loadOverrides();
  const prev = overrides[name];
  const next: RateOverride = {
    name,
    final_price,
    unit: body.unit ?? prev?.unit,
    labor_minutes: num(body.labor_minutes) ?? prev?.labor_minutes,
    material_allowance: num(body.material_allowance) ?? prev?.material_allowance,
    category: body.category ?? prev?.category,
    taxonomy_path: body.taxonomy_path ?? prev?.taxonomy_path,
    isNew: isNew || prev?.isNew,
    source: "screen",
    updatedAt: new Date().toISOString(),
  };
  overrides[name] = next;
  await saveOverrides(overrides);

  return NextResponse.json({ ok: true, override: next, priced: isPriced(final_price), counts: countsFrom(overrides) });
}

// DELETE /api/ratebook — revert one task to its base-book value (drop override).
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  const overrides = await loadOverrides();
  delete overrides[name];
  await saveOverrides(overrides);
  return NextResponse.json({ ok: true, counts: countsFrom(overrides) });
}
