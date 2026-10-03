import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateBook } from "@/lib/loadRateBook";
import { cleanTaskName } from "@/lib/rateBook";
import { WEIGHT, addSample, learnedPrice, seedSamples } from "@/lib/priceSamples";
import {
  OVERRIDES_ID,
  OVERRIDES_NAME,
  applyOverrides,
  parseOverrides,
  rateBookCounts,
  unitLabel,
  type OverrideMap,
} from "@/lib/rateOverrides";

export const runtime = "nodejs";

// Cleaned, lowercased base-task name -> the raw task name, so a quote line whose
// name is the cleaned form ("Above Range Microwave") maps back to the real book
// task ("Above Range Microwave,") and overwrites it instead of adding a dup.
const CANON: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const t of rateBook.tasks) {
    const key = cleanTaskName(t.name).toLowerCase();
    if (key && !m.has(key)) m.set(key, t.name);
  }
  return m;
})();

const round2 = (n: number) => Math.round(n * 100) / 100;

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

// POST /api/ratebook/learn — fold one quote line into the living rate book.
// Adds the line's all-in client price per unit as one job sample on the
// matching task (or creates the task if it is not in the book yet). The task's
// price becomes the weighted middle of its recent jobs instead of whatever was
// typed last, so one odd job can't wreck a good number. See priceSamples.ts.
export async function POST(req: Request) {
  // Owner/admin only: crew quotes never change Manny's pricing.
  const s = await getSession();
  if (!s || s.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { name?: string; unit?: string; allIn?: number; source?: string; ref?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const allIn = Number(body.allIn);
  // Skip blanks, zero/negative prices, and the per-job trip charge (the book
  // already carries the trip fee, no need to relearn it as a task).
  if (!name || !isFinite(allIn) || allIn <= 0 || /\btrip\b/i.test(name)) {
    return NextResponse.json({ ok: false, skipped: true });
  }

  const label = unitLabel(String(body.unit ?? "EA"));
  const overrides = await loadOverrides();

  // Resolve the line name to a canonical task: base book first, then an
  // existing override, else treat it as a brand-new task.
  const cleanedKey = cleanTaskName(name).toLowerCase();
  let target = CANON.get(cleanedKey);
  if (!target) {
    for (const k of Object.keys(overrides)) {
      if (cleanTaskName(k).toLowerCase() === cleanedKey) {
        target = k;
        break;
      }
    }
  }
  const isNewName = !target;
  const targetName = target ?? name;
  const baseTask = rateBook.tasks.find((t) => t.name === targetName);
  const prev = overrides[targetName];

  // History so far: this task's samples, else whatever price it already had
  // (a Rate Book screen price counts like several jobs, anything else like one).
  const existing =
    prev?.samples ??
    (prev
      ? seedSamples(prev.final_price, prev.source === "screen" ? WEIGHT.screen : WEIGHT.legacy, prev.source === "screen" ? "screen" : "legacy", prev.updatedAt)
      : seedSamples(baseTask?.final_price, WEIGHT.legacy, "book"));
  const now = new Date().toISOString();
  const ref = typeof body.ref === "string" && body.ref ? body.ref.slice(0, 120) : `unref-${now}`;
  const samples = addSample(existing, { v: allIn, w: body.source === "ai" ? WEIGHT.ai : WEIGHT.manual, ref, at: now });
  const price = learnedPrice(samples) ?? round2(allIn);

  overrides[targetName] = {
    name: targetName,
    final_price: price,
    unit: label,
    labor_minutes: prev?.labor_minutes ?? baseTask?.labor_minutes ?? null,
    material_allowance: prev?.material_allowance ?? baseTask?.material_allowance ?? null,
    category: baseTask ? String(baseTask.category ?? "") : prev?.category ?? "From Jobs",
    taxonomy_path: baseTask?.taxonomy_path ?? prev?.taxonomy_path,
    isNew: isNewName || prev?.isNew,
    source: "quote",
    updatedAt: now,
    samples,
  };
  await saveOverrides(overrides);

  const counts = rateBookCounts(applyOverrides(rateBook.tasks, overrides), overrides);
  return NextResponse.json({ ok: true, name: targetName, added: isNewName, price, counts });
}
