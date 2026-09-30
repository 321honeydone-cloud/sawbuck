// Read back versus SawBUCK. A push is only SENT when the subtotal matches
// within a penny AND the title and message match. Also spots the split state
// (text and prices disagree) that the old update path used to leave behind.

import type { CompareResult, ExpectedLine, ExpectedPush, JobberLine, JobberQuoteRead, LineDiff } from "./types";

export const PENNY = 0.01;

/** Whitespace and quote style insensitive text compare. */
export function normText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= PENNY + 1e-9;
}

function lineKey(name: string, price: number, qty: number): string {
  return `${normText(name).toLowerCase()}|${(price * qty).toFixed(2)}`;
}

/** Match expected lines to quote lines by name and extended price. */
export function diffLines(expected: ExpectedLine[], actual: JobberLine[]): LineDiff {
  const pool = actual.map((l) => ({ l, key: lineKey(l.name, l.unitPrice, l.quantity), used: false }));
  const missing: ExpectedLine[] = [];
  let matched = 0;
  for (const e of expected) {
    const k = lineKey(e.name, e.unit_price, e.quantity);
    const hit = pool.find((p) => !p.used && p.key === k);
    if (hit) {
      hit.used = true;
      matched++;
    } else missing.push(e);
  }
  return { missing, extra: pool.filter((p) => !p.used).map((p) => p.l), matched };
}

/** Dollar amounts written into the message text, e.g. "Good $1121.75". */
export function pricesInText(s: string): number[] {
  const out: number[] = [];
  const re = /\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Split state: the words on the quote and the numbers on the quote tell two
 * different stories. Two ways to get there:
 *  1. Against SawBUCK: the text matches what we sent but the prices do not, or
 *     the prices match but the text does not (the classic half applied update).
 *  2. Inside the quote itself: the message quotes a headline price
 *     ("Good $1121.75") that is not the quote's subtotal or total.
 */
export function detectSplit(expected: ExpectedPush, read: JobberQuoteRead): { split: boolean; reason: string | null } {
  // The most concrete story first: a headline price in the message that the
  // lines do not add up to.
  const quoted = pricesInText(read.message);
  const headline = quoted.find((p) => /good|price|total/i.test(read.message) && p >= 50);
  if (headline !== undefined && !sameMoney(headline, read.subtotal) && !sameMoney(headline, read.total)) {
    return {
      split: true,
      reason: `Message says $${headline.toFixed(2)} but the lines total $${read.subtotal.toFixed(2)} (total $${read.total.toFixed(2)}).`,
    };
  }
  const subtotalMatch = sameMoney(read.subtotal, expected.subtotal);
  const textMatch = normText(read.title) === normText(expected.title) && normText(read.message) === normText(expected.message);
  if (textMatch !== subtotalMatch) {
    return {
      split: true,
      reason: textMatch
        ? `Text matches SawBUCK but the lines total $${read.subtotal.toFixed(2)}, not $${expected.subtotal.toFixed(2)}.`
        : `Lines total $${read.subtotal.toFixed(2)} like SawBUCK but the title or message is old text.`,
    };
  }
  return { split: false, reason: null };
}

export function compareReadBack(expected: ExpectedPush, read: JobberQuoteRead): CompareResult {
  const subtotalMatch = sameMoney(read.subtotal, expected.subtotal);
  const titleMatch = normText(read.title) === normText(expected.title);
  const messageMatch = normText(read.message) === normText(expected.message);
  const { split, reason } = detectSplit(expected, read);
  const taxMissing = expected.hasTaxable && read.lineItems.some((l) => l.taxable) && read.taxAmount <= 0;
  return {
    subtotalMatch,
    titleMatch,
    messageMatch,
    textMatch: titleMatch && messageMatch,
    split,
    splitReason: reason,
    expectedSubtotal: expected.subtotal,
    readSubtotal: read.subtotal,
    delta: Math.round((read.subtotal - expected.subtotal) * 100) / 100,
    taxMissing,
    lineDiff: diffLines(expected.lines, read.lineItems),
  };
}

/** SENT means subtotal within a penny and the text matches. Tax is checked separately by the heal loop. */
export function isSent(c: CompareResult): boolean {
  return c.subtotalMatch && c.textMatch;
}
