// Saves Pricing Research findings into the living rate book.
//
// Mirrors how /api/ratebook/learn folds a quote line in: resolve the task to a
// canonical book task (so we overwrite instead of duplicating), then upsert the
// median price into the overrides row (CATALOG-RATE-OVERRIDES). Tagged source
// "research" so these auto-filled prices are easy to spot and correct later on
// the Rate Book screen. Server-only.

import { prisma } from "./db";
import { rateBook } from "./loadRateBook";
import { cleanTaskName } from "./rateBook";
import { OVERRIDES_ID, OVERRIDES_NAME, parseOverrides, type OverrideMap } from "./rateOverrides";
import type { PriceFinding } from "./agents/pricing";

// Cleaned, lowercased base-task name -> the raw book task name.
const CANON: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const t of rateBook.tasks) {
    const key = cleanTaskName(t.name).toLowerCase();
    if (key && !m.has(key)) m.set(key, t.name);
  }
  return m;
})();

const UNIT_LABEL: Record<string, string> = {
  each: "each", ea: "each",
  "sq ft": "per sq ft", "square foot": "per sq ft", "square feet": "per sq ft", sf: "per sq ft", sqft: "per sq ft",
  "linear ft": "per linear foot", "linear foot": "per linear foot", lf: "per linear foot",
  hour: "per hour", hours: "per hour", hr: "per hour",
  day: "per day",
  "sq yard": "per sq yard", "cubic yard": "per cubic yard",
  "lump sum": "lump sum", ls: "lump sum", job: "lump sum",
};
const toLabel = (u: string): string => UNIT_LABEL[(u || "").toLowerCase().trim()] ?? "each";
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Upsert each finding's median price into the rate-book overrides. Returns count saved. */
export async function saveResearchedPrices(findings: PriceFinding[]): Promise<number> {
  if (findings.length === 0) return 0;
  const row = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
  const overrides: OverrideMap = parseOverrides(row?.items);

  let saved = 0;
  for (const f of findings) {
    const name = (f.task || "").trim();
    if (!name || !(f.median > 0) || /\btrip\b/i.test(name)) continue;

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
    const isNew = !target;
    const targetName = target ?? name;
    const baseTask = rateBook.tasks.find((t) => t.name === targetName);
    const prev = overrides[targetName];

    overrides[targetName] = {
      name: targetName,
      final_price: round2(f.median),
      unit: toLabel(f.unit),
      labor_minutes: prev?.labor_minutes ?? baseTask?.labor_minutes ?? null,
      material_allowance: prev?.material_allowance ?? baseTask?.material_allowance ?? null,
      category: baseTask ? String(baseTask.category ?? "") : prev?.category ?? "Market Research",
      taxonomy_path: baseTask?.taxonomy_path ?? prev?.taxonomy_path,
      isNew: isNew || prev?.isNew,
      source: "research",
      updatedAt: new Date().toISOString(),
    };
    saved++;
  }

  if (saved > 0) {
    await prisma.catalog.upsert({
      where: { id: OVERRIDES_ID },
      update: { items: JSON.stringify(overrides) },
      create: { id: OVERRIDES_ID, name: OVERRIDES_NAME, type: "mixed", items: JSON.stringify(overrides) },
    });
  }
  return saved;
}
