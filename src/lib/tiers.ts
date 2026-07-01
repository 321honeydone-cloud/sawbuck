// Service tiers — good / better / best for a HoneyDone quote.
//
// Standard is the working estimate as built. Competitive trims scope and uses
// value materials. Premium upgrades materials, adds prep, and adds a longer
// warranty. The AI rebuilds Competitive and Premium from the Standard build
// (see /api/tiers); deterministicTiers() is the offline fallback so the feature
// always works without a key. This file is client-safe (no server-only imports).

import { recalcEstimate } from "./totals";
import type { Estimate, Group, LineItem, ServiceTier, TierVariant } from "./types";

export interface TierConfig {
  key: ServiceTier;
  label: string;
  blurb: string;
  guidance: string; // fed to the AI when it rebuilds this tier
}

export const SERVICE_TIERS: TierConfig[] = [
  {
    key: "competitive",
    label: "Competitive",
    blurb: "Budget-minded. Essential scope, value materials, no extras.",
    guidance:
      "Trim to the essential scope that still does the job right and to code. Use value-grade materials. Keep labor lean. Drop optional upgrades and nice-to-haves. This is the lowest responsible price.",
  },
  {
    key: "standard",
    label: "Standard",
    blurb: "Recommended. Quality materials, full scope, clean finish.",
    guidance:
      "The default HoneyDone build. Quality mid-grade materials, full and proper scope, clean professional finish.",
  },
  {
    key: "premium",
    label: "Premium",
    blurb: "Top-tier. Upgraded materials, extra prep, longer warranty.",
    guidance:
      "Upgrade to premium materials and fixtures. Add extra surface prep and protection. Add a dedicated premium service line with a longer workmanship warranty and white-glove cleanup. This is the best build.",
  },
];

export const tierConfig = (tier: ServiceTier): TierConfig =>
  SERVICE_TIERS.find((t) => t.key === tier) ?? SERVICE_TIERS[1];

// ---------------------------------------------------------------------------
// Deterministic fallback: derive Competitive and Premium from the Standard build.
// ---------------------------------------------------------------------------

let did = 0;
const nid = (p: string) => `${p}_tier${Date.now().toString(36)}${(did++).toString(36)}`;

function clone(est: Estimate): Estimate {
  return { ...est, groups: est.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) })) };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Scale material cost and labor hours by tier factors, then recalc. */
function scaled(base: Estimate, materialFactor: number, laborFactor: number): Estimate {
  const next = clone(base);
  for (const g of next.groups) {
    for (const it of g.items) {
      if (it.costType === "Material") it.unitCost = round2(it.unitCost * materialFactor);
      else if (it.costType === "Labor") it.quantity = Math.max(1, Math.round(it.quantity * laborFactor * 2) / 2);
    }
  }
  return recalcEstimate(next);
}

function mkItem(
  groupId: string,
  position: number,
  name: string,
  quantity: number,
  unit: LineItem["unit"],
  unitCost: number,
  costType: LineItem["costType"],
  markupPct: number,
  supplier: string | null = null
): LineItem {
  return {
    id: nid("li"),
    groupId,
    position,
    name,
    quantity,
    unit,
    unitCost,
    costType,
    markupPct,
    supplier,
    supplierPrice: null,
    notes: null,
    builderCost: 0,
    markupAmount: 0,
    clientTotal: 0,
  };
}

/** Premium = upgraded base + a dedicated premium service group. */
function premiumFrom(base: Estimate): Estimate {
  const up = scaled(base, 1.22, 1.1);
  const baseMaterial = up.groups
    .flatMap((g) => g.items)
    .filter((i) => i.costType === "Material")
    .reduce((s, i) => s + i.builderCost, 0);
  const gid = nid("grp");
  const group: Group = {
    id: gid,
    position: up.groups.length + 1,
    name: "Premium Service",
    items: [
      mkItem(gid, 1, "Extra surface prep & protection", 4, "HRS", 100, "Labor", 0),
      mkItem(gid, 2, "Upgraded fixtures & material allowance", 1, "LS", round2(baseMaterial * 0.15), "Material", 25, "Ferguson"),
      mkItem(gid, 3, "2-year workmanship warranty & white-glove cleanup", 1, "LS", 150, "Other", 0),
    ],
    subtotalBuilder: 0,
    subtotalClient: 0,
  };
  up.groups = [...up.groups, group];
  return recalcEstimate(up);
}

export function deterministicTiers(base: Estimate): TierVariant[] {
  const standard = recalcEstimate(clone(base));
  const competitive = scaled(base, 0.88, 0.9);
  const premium = premiumFrom(base);
  return [
    { tier: "competitive", name: base.name, groups: competitive.groups, totals: competitive.totals },
    { tier: "standard", name: base.name, groups: standard.groups, totals: standard.totals },
    { tier: "premium", name: base.name, groups: premium.groups, totals: premium.totals },
  ];
}
