// What SawBUCK expects the Jobber quote to hold after an update push. One pure
// function so the orchestrator, the healer chat, and the diff on the result
// sheet all compare against the same truth.
//
// Line shape follows how Manny's quotes already sit in Jobber (see quote
// 20260089): one labor line per trade group, not taxable, plus one
// "Materials and supplies" line that carries every material at the client
// price and IS taxable. Struck (off) lines never make it on. The subtotal is
// the estimate's cash total, so the read back check is a straight compare.

import type { Estimate, LineItem } from "../types";
import { round2 } from "../totals";
import type { ExpectedLine, ExpectedPush, QuoteSnapshot, JobberQuoteRead } from "./types";

export const MATERIALS_LINE_NAME = "Materials and supplies";

export interface ExpectedTextParts {
  title: string;
  scopeOfWork: string;
  exclusions: string[];
}

/** Clean a line name or description the way the quote wording rules want: no em or en dashes, no semicolons. */
export function cleanText(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/;/g, ",").replace(/[ \t]+/g, " ").trim();
}

function live(items: LineItem[]): LineItem[] {
  return items.filter((i) => !i.off);
}

/** Build the client facing message: scope paragraph, then the exclusions list. */
export function buildMessage(parts: ExpectedTextParts): string {
  const out: string[] = [cleanText(parts.scopeOfWork)];
  const ex = parts.exclusions.map(cleanText).filter(Boolean);
  if (ex.length) {
    out.push("", "Not included in this job scope:", ...ex.map((e, i) => `${i + 1}. ${e}`));
  }
  return out.join("\n").trim();
}

/** A title from the scope when the quote has none. "Hooks, towel racks and wall art install". */
export function titleFromScope(estimate: Estimate): string {
  const names: string[] = [];
  for (const g of estimate.groups) {
    for (const i of live(g.items)) {
      if (i.costType === "Material") continue;
      const n = cleanText(i.name).split(/[,(.]/)[0].trim().toLowerCase();
      if (n && !names.includes(n) && !/trip charge|cleanup|haul/.test(n)) names.push(n);
      if (names.length >= 3) break;
    }
    if (names.length >= 3) break;
  }
  if (!names.length) {
    const fallback = cleanText(estimate.name || "General work");
    return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  }
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const t = `${joined} install`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The lines SawBUCK wants on the quote, from the live (not struck) items. */
export function buildExpectedLines(estimate: Estimate): ExpectedLine[] {
  const lines: ExpectedLine[] = [];
  let materials = 0;
  const materialNames: string[] = [];
  for (const g of estimate.groups.slice().sort((a, b) => a.position - b.position)) {
    const items = live(g.items);
    const labor = items.filter((i) => i.costType !== "Material");
    const mats = items.filter((i) => i.costType === "Material");
    const laborTotal = round2(labor.reduce((s, i) => s + i.clientTotal, 0));
    if (labor.length && laborTotal > 0) {
      lines.push({
        name: cleanText(g.name),
        description: cleanText(labor.map((i) => i.name).join(". ")) + ".",
        quantity: 1,
        unit_price: laborTotal,
        taxable: false,
      });
    }
    for (const m of mats) {
      materials = round2(materials + m.clientTotal);
      materialNames.push(cleanText(m.name));
    }
  }
  if (materials > 0) {
    lines.push({
      name: MATERIALS_LINE_NAME,
      description: materialNames.join(", ") + ".",
      quantity: 1,
      unit_price: materials,
      taxable: true,
    });
  }
  return lines;
}

/** Everything the update push should land on the quote. */
export function buildExpectedPush(estimate: Estimate, text: ExpectedTextParts): ExpectedPush {
  const lines = buildExpectedLines(estimate);
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.quantity * l.unit_price), 0));
  return {
    title: cleanText(text.title),
    message: buildMessage(text),
    lines,
    subtotal,
    hasTaxable: lines.some((l) => l.taxable),
  };
}

/** Compact view of a read back for logs and diffs. */
export function snapshotOf(read: JobberQuoteRead | Partial<JobberQuoteRead> | null | undefined): QuoteSnapshot | null {
  if (!read) return null;
  return {
    quoteStatus: read.quoteStatus ?? "",
    title: read.title ?? "",
    message: read.message ?? "",
    lines: (read.lineItems ?? []).map((l) => ({
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxable: l.taxable,
    })),
    subtotal: read.subtotal ?? 0,
    taxAmount: read.taxAmount ?? 0,
    total: read.total ?? 0,
  };
}

/** What the quote WOULD look like if these lines and text landed. Tax is an estimate. */
export function snapshotOfExpected(
  exp: { title: string; message: string; lines: ExpectedLine[] },
  opts: { quoteStatus?: string; taxRate?: number | null } = {}
): QuoteSnapshot {
  const subtotal = round2(exp.lines.reduce((s, l) => s + round2(l.quantity * l.unit_price), 0));
  const taxable = round2(exp.lines.filter((l) => l.taxable).reduce((s, l) => s + round2(l.quantity * l.unit_price), 0));
  const taxAmount = opts.taxRate ? round2(taxable * opts.taxRate) : 0;
  return {
    quoteStatus: opts.quoteStatus ?? "draft",
    title: exp.title,
    message: exp.message,
    lines: exp.lines.map((l) => ({
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      taxable: l.taxable,
    })),
    subtotal,
    taxAmount,
    total: round2(subtotal + taxAmount),
  };
}
