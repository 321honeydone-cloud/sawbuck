// Deterministic Complications Cap generator.
//
// The estimator is instructed to add a "Complications Cap (only if needed)"
// section on every quote, but a weaker local model sometimes skips it. This
// guarantees it: if a turn ends with no cap section, the Boss injects one so the
// quote always carries a Max Price Guarantee. Allowances are itemized by the
// risky work actually in the scope, priced as a transparent share of the base
// so Manny can eyeball and edit them on the sheet. Pure — safe on server/client.

import type { Operation } from "./types";

/** Max Price Guarantee buffer as a share of the base scope. */
const CAP_PCT = 0.25;
const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

export const CAP_GROUP_NAME = "Complications Cap (only if needed)";

// Risky work → the "only if needed" allowance it justifies.
const RISKS: { rx: RegExp; label: string }[] = [
  { rx: /faucet|valve|cartridge|supply line|shut ?off|angle stop|hose bib/i, label: "If a faucet valve or supply line is corroded and must be replaced" },
  { rx: /outlet|gfci|breaker|wiring|circuit|receptacle|switch/i, label: "If an outlet is dead or miswired and needs a new GFCI or repair" },
  { rx: /drain|p-?trap|clog|garbage disposal|water heater|leak/i, label: "If a drain or supply line must be opened up and repaired" },
  { rx: /door|window|track|hinge|slider|threshold|screen/i, label: "If a door or window is warped and needs added hardware or adjustment" },
  { rx: /rot|water damage|subfloor|framing|stud|joist|soft spot|deteriorat/i, label: "If hidden rot or damage is found once the area is opened" },
  { rx: /tile|grout|caulk|waterproof|pan liner|backsplash/i, label: "If tile or waterproofing must be cut out and rebuilt" },
];

/**
 * Build the operations that add a Complications Cap group for a scope. `scopeText`
 * is the combined line-item names; `baseTotal` is the base (Smooth) client total.
 */
export function complicationsCapOps(scopeText: string, baseTotal: number): Operation[] {
  if (!(baseTotal > 0)) return [];
  const text = (scopeText || "").toLowerCase();
  const matched = RISKS.filter((r) => r.rx.test(text)).slice(0, 4);

  const ops: Operation[] = [{ op: "add_group", name: CAP_GROUP_NAME }];

  if (matched.length === 0) {
    ops.push({
      op: "add_line_item",
      groupName: CAP_GROUP_NAME,
      name: "Unforeseen complications allowance, only charged if a hidden issue is found",
      quantity: 1,
      unit: "LS",
      unitCost: round5(baseTotal * 0.15),
      costType: "Other",
    });
    return ops;
  }

  const per = Math.max(50, round5((baseTotal * CAP_PCT) / matched.length));
  for (const m of matched) {
    ops.push({
      op: "add_line_item",
      groupName: CAP_GROUP_NAME,
      name: m.label,
      quantity: 1,
      unit: "LS",
      unitCost: per,
      costType: "Other",
    });
  }
  return ops;
}
