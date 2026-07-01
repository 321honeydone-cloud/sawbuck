// The learning rate book.
//
// Every time Manny edits a line item (or accepts an AI-built one), the item's
// current spec is folded into a shop-wide rate book. Over time the book grows
// into a record of what HoneyDone actually charges, and it gets fed back into
// the AI estimator so future estimates lean on real, used numbers.
//
// Stored in the existing Catalog model (one row, JSON `items`) so it needs no
// schema migration. Client + server safe — no Prisma import here.

import type { CostType, Unit } from "./types";
import { CATALOG } from "./honeydone";

export const RATEBOOK_ID = "CATALOG-RATEBOOK";
export const RATEBOOK_NAME = "Learned Rate Book";

export interface RateBookItem {
  key: string; // normalized identity (costType|unit|name)
  name: string;
  unit: Unit;
  costType: CostType;
  unitCost: number;
  supplier: string | null;
  useCount: number;
  source: "seed" | "manual" | "ai";
  updatedAt: string; // ISO
}

/** Identity used to dedupe rates: same work + unit + cost type collapses together. */
export function rateKey(name: string, unit: string, costType: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `${costType}|${unit}|${n}`;
}

export interface RateInput {
  name: string;
  unit: Unit;
  costType: CostType;
  unitCost: number;
  supplier?: string | null;
  source?: RateBookItem["source"];
}

/** Worth remembering? Skip blanks and zero-cost noise. */
export function isLearnable(input: { name?: string; unitCost?: number }): boolean {
  return !!input.name && input.name.trim().length > 1 && typeof input.unitCost === "number" && input.unitCost > 0;
}

/**
 * Fold one rate into the book. If the key already exists we update the price and
 * supplier to the latest, keep the newest name, and bump the use count. New keys
 * are appended. Returns a fresh array.
 */
export function mergeRate(items: RateBookItem[], input: RateInput): RateBookItem[] {
  const key = rateKey(input.name, input.unit, input.costType);
  const now = new Date().toISOString();
  const next = items.slice();
  const idx = next.findIndex((r) => r.key === key);
  if (idx >= 0) {
    const prev = next[idx];
    next[idx] = {
      ...prev,
      name: input.name.trim(),
      unitCost: input.unitCost,
      supplier: input.supplier ?? prev.supplier,
      useCount: prev.useCount + 1,
      source: input.source ?? prev.source,
      updatedAt: now,
    };
  } else {
    next.push({
      key,
      name: input.name.trim(),
      unit: input.unit,
      costType: input.costType,
      unitCost: input.unitCost,
      supplier: input.supplier ?? null,
      useCount: 1,
      source: input.source ?? "manual",
      updatedAt: now,
    });
  }
  return next;
}

/** Parse the JSON items blob defensively. */
export function parseRateBook(json: string | null | undefined): RateBookItem[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as RateBookItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Initial rate book built from the static HoneyDone price book. */
export function seedRateBook(): RateBookItem[] {
  let items: RateBookItem[] = [];
  for (const cat of CATALOG) {
    for (const it of cat.items) {
      items = mergeRate(items, {
        name: it.name,
        unit: it.unit,
        costType: it.costType,
        unitCost: it.unitCost,
        supplier: it.supplier ?? null,
        source: "seed",
      });
    }
  }
  return items;
}

/** Render the learned rates for the AI system prompt (most-used first). */
export function formatLearnedRates(items: RateBookItem[], limit = 60): string {
  const learned = items.filter((r) => r.source !== "seed");
  if (learned.length === 0) return "";
  const top = learned.slice().sort((a, b) => b.useCount - a.useCount).slice(0, limit);
  const lines = top.map((r) => {
    const sup = r.supplier ? ` [${r.supplier}]` : "";
    return `  - ${r.name}: ${r.costType}, ${r.unit} @ $${r.unitCost}${sup} (used ${r.useCount}x)`;
  });
  return `\n\nLearned rates from this shop's past estimates. Prefer these exact numbers when the work matches, they reflect what HoneyDone actually charged:\n${lines.join("\n")}`;
}
