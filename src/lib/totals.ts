import type { Estimate, Group, LineItem, Totals } from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Recompute a line item's derived money fields from quantity / unitCost / markupPct. */
export function recalcLineItem(item: LineItem): LineItem {
  const builderCost = round2(item.quantity * item.unitCost);
  const markupAmount = round2(builderCost * (item.markupPct / 100));
  const clientTotal = round2(builderCost + markupAmount);
  return { ...item, builderCost, markupAmount, clientTotal };
}

/** Recompute a group's subtotals from its (already-recalculated) items. */
export function recalcGroup(group: Group): Group {
  const items = group.items.map(recalcLineItem);
  const subtotalBuilder = round2(items.reduce((s, i) => s + i.builderCost, 0));
  const subtotalClient = round2(items.reduce((s, i) => s + i.clientTotal, 0));
  return { ...group, items, subtotalBuilder, subtotalClient };
}

export function computeTotals(groups: Group[]): Totals {
  let totalCost = 0;
  let totalMarkup = 0;
  for (const g of groups) {
    for (const i of g.items) {
      totalCost += i.builderCost;
      totalMarkup += i.markupAmount;
    }
  }
  totalCost = round2(totalCost);
  totalMarkup = round2(totalMarkup);
  const estimateTotal = round2(totalCost + totalMarkup);
  // Profit margin = markup / client total (0 when there is nothing to bill).
  const profitMargin = estimateTotal > 0 ? round2((totalMarkup / estimateTotal) * 100) : 0;
  return { totalCost, totalMarkup, estimateTotal, profitMargin };
}

/** Recompute everything: every line item, every group subtotal, and the estimate totals. */
export function recalcEstimate(estimate: Estimate): Estimate {
  const groups = estimate.groups.map(recalcGroup);
  return { ...estimate, groups, totals: computeTotals(groups) };
}

export { round2 };
