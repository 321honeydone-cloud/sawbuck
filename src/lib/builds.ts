// Two-build split for a HoneyDone quote.
//
// Every finalized quote is shown as TWO numbers, never a single worst-case
// figure (see the estimator system prompt in ai.ts):
//   - Smooth Scenario: the honest expected price if the work goes as planned.
//     This is every group EXCEPT the "Complications Cap" group.
//   - Max Cost Guarantee: the absolute ceiling. This is the whole estimate,
//     base scope plus the conditional "if-needed" allowances in the cap group.
//
// The estimator builds the base work in normal trade groups and drops the
// conditional allowances into one group named "Complications Cap (only if
// needed)". Finalize just splits the sheet on that group, so Manny can see and
// edit every allowance before the quote goes out. Client-safe (no server imports).

import { computeTotals } from "./totals";
import { cardPrice } from "./honeydone";
import type { Estimate, LineItem } from "./types";

// A group is the complications cap if its name reads like a conditional buffer.
const CAP_RE = /complication|only if needed|max cost|contingenc|if[-\s]?needed|worst[-\s]?case/i;

export const isCapGroup = (name: string): boolean => CAP_RE.test(name);

export interface BuildSplit {
  /** True when a Complications Cap group exists and actually adds cost. */
  hasCap: boolean;
  smoothCash: number; // expected price, base scope only
  smoothCard: number;
  maxCash: number; // ceiling, base + all allowances
  maxCard: number;
  capCash: number; // just the allowance buffer (maxCash - smoothCash)
  capItems: LineItem[]; // the conditional allowance lines, for listing
}

/** Split an estimate into the Smooth Scenario and Max Cost Guarantee builds. */
export function splitBuilds(estimate: Estimate): BuildSplit {
  const baseGroups = estimate.groups.filter((g) => !isCapGroup(g.name));
  const capGroups = estimate.groups.filter((g) => isCapGroup(g.name));

  const smoothCash = computeTotals(baseGroups).estimateTotal;
  const maxCash = computeTotals(estimate.groups).estimateTotal;
  const capItems = capGroups.flatMap((g) => g.items);

  return {
    hasCap: capGroups.length > 0 && maxCash > smoothCash,
    smoothCash,
    smoothCard: cardPrice(smoothCash),
    maxCash,
    maxCard: cardPrice(maxCash),
    capCash: Math.round((maxCash - smoothCash) * 100) / 100,
    capItems,
  };
}
