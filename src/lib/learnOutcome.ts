// When a quote is invoiced (won) or deleted, re-weight every price it taught.
//
// Prices are learned the moment a line is edited or accepted, long before
// anyone knows if the client will pay. This closes that gap: marking a quote
// Invoiced makes its prices count triple in both rate books, deleting it makes
// them count half, and moving an invoiced quote back clears the boost. The
// learned price is recomputed on the spot. Server-only.

import { prisma } from "./db";
import { RATEBOOK_ID, parseRateBook } from "./rates";
import { OVERRIDES_ID, parseOverrides } from "./rateOverrides";
import { learnedPrice, markOutcome, type SampleOutcome } from "./priceSamples";

/** Stamp an outcome on one quote's samples. Returns how many rates changed. */
export async function markEstimateOutcome(estimateId: string, outcome: SampleOutcome | null): Promise<number> {
  if (!estimateId) return 0;
  let changed = 0;

  // Learned rate book (cost per unit, fed to the estimator as "learned rates").
  const rateRow = await prisma.catalog.findUnique({ where: { id: RATEBOOK_ID } });
  if (rateRow) {
    let dirty = false;
    const items = parseRateBook(rateRow.items).map((it) => {
      const samples = markOutcome(it.samples, estimateId, outcome);
      if (!samples) return it;
      dirty = true;
      changed++;
      return { ...it, samples, unitCost: learnedPrice(samples) ?? it.unitCost };
    });
    if (dirty) await prisma.catalog.update({ where: { id: RATEBOOK_ID }, data: { items: JSON.stringify(items) } });
  }

  // Rate Book overrides (all-in client price per unit, the Rate Book screen).
  const ovRow = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
  if (ovRow) {
    let dirty = false;
    const overrides = parseOverrides(ovRow.items);
    for (const [k, ov] of Object.entries(overrides)) {
      const samples = markOutcome(ov.samples, estimateId, outcome);
      if (!samples) continue;
      dirty = true;
      changed++;
      overrides[k] = { ...ov, samples, final_price: learnedPrice(samples) ?? ov.final_price };
    }
    if (dirty) await prisma.catalog.update({ where: { id: OVERRIDES_ID }, data: { items: JSON.stringify(overrides) } });
  }

  return changed;
}
