// Deterministic, trade-aware exclusion suggestions. These seed and grow the
// client-facing exclusions list as a quote grows, so the contractor is covered
// without writing the same disclaimers every time. The user can strike any of
// these or add their own, and those edits are preserved.

import type { Estimate } from "./types";

const BASE: string[] = [
  "Permit fees unless explicitly stated in the scope",
  "Hidden rot, water damage, or structural deterioration found during or after demo, which will be quoted separately",
  "Work on any surface or area not listed in the scope",
  "Haul-away or disposal unless explicitly included in the scope",
];

const TRADE: { rx: RegExp; items: string[] }[] = [
  { rx: /paint|drywall|texture/i, items: ["Matching existing paint color or sheen exactly cannot be guaranteed", "Priming or painting of new materials unless stated in the scope"] },
  { rx: /tile|grout|shower|tub|bath|caulk/i, items: ["Replacing the substrate or subfloor behind tile unless stated", "Matching a discontinued tile or grout color cannot be guaranteed"] },
  { rx: /plumb|toilet|faucet|sink|drain|water heater|valve/i, items: ["Moving or re-routing supply or drain lines unless stated", "Existing shutoffs or valves that fail during the work are repaired at additional cost"] },
  { rx: /electric|outlet|gfci|panel|wiring|fixture|switch/i, items: ["Panel upgrades or bringing existing wiring up to current code unless stated"] },
  { rx: /fascia|soffit|roof|gutter|exterior|siding|stucco/i, items: ["Roofline, soffit, or fascia work beyond the area listed", "Sheathing found rotted after removal is repaired at additional cost"] },
  { rx: /deck|fence|railing|post/i, items: ["Footings or posts found rotted below grade are replaced at additional cost"] },
  { rx: /pressure wash|power wash|soft wash|wash/i, items: ["Stains that have permanently etched a surface may not fully clear"] },
];

/** Build the suggested exclusion texts for an estimate from its trades and items. */
export function suggestExclusions(estimate: Estimate): string[] {
  const text = estimate.groups.map((g) => `${g.name} ${g.items.map((i) => i.name).join(" ")}`).join(" ");
  const out: string[] = [...BASE];
  for (const t of TRADE) if (t.rx.test(text)) out.push(...t.items);
  return Array.from(new Set(out));
}
