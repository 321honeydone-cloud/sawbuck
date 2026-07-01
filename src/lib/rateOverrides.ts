// Rate-book overrides — the durable, editable layer on top of the static
// src/data/rate_book.json base. Manny prices the 696 taxonomy stubs (and edits
// any of the 459 priced tasks) inside the app. Each saved edit is stored as an
// override keyed by task name, so it survives production rebuilds (the static
// JSON never gets rewritten on disk). The Rate Book screen, the flat-rate
// engine, and the Claude estimator all read the base book with these overrides
// applied on top.
//
// This file is pure and isomorphic: no prisma, no next imports. The API route
// owns persistence (a single Catalog row), this owns the merge math so the
// client engine can apply the same overrides without a server round-trip of the
// whole 416KB book.

import type { RateTask } from "./rateBook";

/** Catalog row that holds the override map (JSON). No schema migration needed. */
export const OVERRIDES_ID = "CATALOG-RATE-OVERRIDES";
export const OVERRIDES_NAME = "Rate Book Overrides";

/** One editable price record, keyed in the map by the task name it overrides. */
export interface RateOverride {
  name: string;
  final_price: number | null;
  unit?: string;
  labor_minutes?: number | null;
  material_allowance?: number | null;
  // Present only for tasks created from scratch (not in the base book).
  category?: string;
  taxonomy_path?: string;
  isNew?: boolean;
  source?: string; // "screen" = edited on the Rate Book page, "quote" = learned from a quote
  updatedAt: string; // ISO
}

export type OverrideMap = Record<string, RateOverride>;

/** Canonical unit labels offered in the editor and understood by the engine. */
export const UNIT_OPTIONS = [
  "each",
  "per sq ft",
  "per linear foot",
  "per hour",
  "per visit",
  "per day",
  "per sq yard",
  "per cubic yard",
  "lump sum",
  // Per-piece units (Handyman Pricing Handbook). The engine treats any unit
  // that is not "per sq ft" / "per linear foot" as a plain quantity multiplier,
  // so these price per item via the line quantity (e.g. 5 pulls x $8).
  "per pull",
  "per hinge",
  "per recessed light",
  "per fence panel",
  "per fence post",
  "per picture",
  "per pickup load",
] as const;

/** Map an estimate Unit enum (EA, SF, ...) to a rate-book unit label. */
export const UNIT_LABEL_FROM_ENUM: Record<string, string> = {
  EA: "each",
  HRS: "per hour",
  SF: "per sq ft",
  LF: "per linear foot",
  SY: "per sq yard",
  CY: "per cubic yard",
  DAY: "per day",
  LS: "lump sum",
};

export function unitLabel(u: string): string {
  return UNIT_LABEL_FROM_ENUM[u] ?? (u || "each");
}

/** Parse the stored override blob defensively. Always returns a real map. */
export function parseOverrides(json: string | null | undefined): OverrideMap {
  if (!json) return {};
  try {
    const obj = JSON.parse(json) as OverrideMap;
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

/** A real, usable price: a positive number. Anything else leaves a stub unpriced. */
export function isPriced(price: number | null | undefined): boolean {
  return typeof price === "number" && isFinite(price) && price > 0;
}

/**
 * Apply the override map on top of the base task list and return a fresh merged
 * list. Existing tasks get their edited fields; pricing a task (final_price > 0)
 * clears needs_price so the engine will quote it. Net-new tasks (isNew) are
 * appended. Order is preserved, new tasks land at the end.
 */
export function applyOverrides(base: RateTask[], overrides: OverrideMap): RateTask[] {
  const out: RateTask[] = base.map((t) => {
    const ov = overrides[t.name];
    if (!ov) return t;
    const final_price = ov.final_price ?? t.final_price ?? null;
    const merged: RateTask = {
      ...t,
      final_price,
      unit: ov.unit ?? t.unit,
      labor_minutes: ov.labor_minutes ?? t.labor_minutes,
      material_allowance: ov.material_allowance ?? t.material_allowance,
      needs_price: !isPriced(final_price),
    };
    return merged;
  });

  const baseNames = new Set(base.map((t) => t.name));
  for (const ov of Object.values(overrides)) {
    if (ov.isNew && !baseNames.has(ov.name)) {
      out.push({
        name: ov.name,
        category: ov.category ?? "Custom",
        final_price: ov.final_price ?? null,
        unit: ov.unit ?? "each",
        labor_minutes: ov.labor_minutes ?? undefined,
        material_allowance: ov.material_allowance ?? undefined,
        market_override: null,
        source_tag: "manny_override",
        needs_price: !isPriced(ov.final_price),
        taxonomy_path: ov.taxonomy_path,
      });
    }
  }
  return out;
}

export interface RateBookCounts {
  total: number;
  priced: number;
  stubs: number;
  overridden: number;
}

/** Progress counts off a merged task list ("X of Y priced"). */
export function rateBookCounts(merged: RateTask[], overrides: OverrideMap): RateBookCounts {
  let priced = 0;
  let stubs = 0;
  for (const t of merged) {
    if (isPriced(t.final_price)) priced++;
    else stubs++;
  }
  return { total: merged.length, priced, stubs, overridden: Object.keys(overrides).length };
}

/**
 * Render Manny-set prices for the Claude estimator system prompt. Only the
 * tasks he actually priced/edited get injected (high signal, low token cost),
 * so chat estimates lean on his real numbers as they grow.
 */
export function formatRateBookForPrompt(overrides: OverrideMap, limit = 80): string {
  const priced = Object.values(overrides)
    .filter((o) => isPriced(o.final_price))
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, limit);
  if (priced.length === 0) return "";
  const lines = priced.map((o) => {
    const unit = o.unit && o.unit !== "each" ? ` per ${o.unit.replace(/^per /, "")}` : " each";
    return `  - ${o.name}: $${o.final_price}${unit}`;
  });
  return `\n\nHoneyDone rate-book prices Manny set by hand. These are authoritative, use the exact number when the work matches:\n${lines.join("\n")}`;
}


/**
 * Render the whole priced rate book for the Claude estimator prompt, grouped by
 * trade. These are all-in flat prices for the entire task (labor, materials,
 * and profit baked in), distinct from the cost-plus catalog. Manny asked for the
 * full book so chat estimates can lean on his real, used numbers.
 */
export function formatPricedBookForPrompt(tasks: RateTask[]): string {
  const priced = tasks.filter((t) => isPriced(t.final_price));
  if (priced.length === 0) return "";
  const byCat = new Map<string, RateTask[]>();
  for (const t of priced) {
    const cat = String(t.category ?? "Other") || "Other";
    const arr = byCat.get(cat) ?? [];
    arr.push(t);
    byCat.set(cat, arr);
  }
  const blocks: string[] = [];
  for (const [cat, arr] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const lines = arr
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const unit = t.unit && t.unit !== "each" ? ` per ${String(t.unit).replace(/^per /, "")}` : " each";
        return `  - ${t.name}: $${t.final_price}${unit}`;
      });
    blocks.push(`${cat}:
${lines.join("\n")}`);
  }
  return (
    "\n\nHoneyDone flat rate-book prices (all-in per task, labor and materials and profit already included). " +
    "When a job matches one of these tasks, you may price that work as a single all-in line (costType Other, unitCost = the flat price) instead of building it up, and say you priced it from the rate book. For a price listed per sq ft or per linear foot, set quantity to the area or length from the job (rate times area). These are Manny's real numbers, prefer them when the work matches:\n" +
    blocks.join("\n")
  );
}
