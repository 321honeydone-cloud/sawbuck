// Service tiers, now rebuilt by the local Estimator employee.
// Given the Standard build, the local model emits Competitive and Premium as
// build operations. Falls back to deterministic tiers if the model is down.
import { NextResponse } from "next/server";
import { HONEYDONE } from "@/lib/honeydone";
import { deterministicTiers, tierConfig } from "@/lib/tiers";
import { genTiers } from "@/lib/agents/estimateExtras";
import { applyOperations } from "@/lib/operations";
import { recalcEstimate } from "@/lib/totals";
import type { Estimate, Operation, TierVariant } from "@/lib/types";

export const runtime = "nodejs";

/** A blank estimate the operations engine can build a tier onto. */
function blankLike(base: Estimate): Estimate {
  return {
    ...base,
    groups: [],
    totals: { totalCost: 0, totalMarkup: 0, estimateTotal: 0, profitMargin: 0 },
  };
}

function buildVariant(base: Estimate, ops: Operation[], tier: TierVariant["tier"]): TierVariant {
  const built = applyOperations(blankLike(base), ops).estimate;
  return { tier, name: base.name, groups: built.groups, totals: built.totals };
}

function standardContext(estimate: Estimate): string {
  const lines: string[] = [`Standard build for "${estimate.name}":`];
  for (const g of estimate.groups) {
    lines.push(`Group: ${g.name}`);
    for (const i of g.items) {
      lines.push(`  - ${i.name} | ${i.quantity} ${i.unit} @ $${i.unitCost} | ${i.costType}${i.supplier ? ` | ${i.supplier}` : ""}`);
    }
  }
  return lines.join("\n");
}

// POST /api/tiers, rebuild Competitive and Premium from the Standard estimate.
export async function POST(req: Request) {
  let estimate: Estimate;
  try {
    const body = (await req.json()) as { estimate?: Estimate };
    if (!body.estimate) return NextResponse.json({ error: "missing_estimate" }, { status: 400 });
    estimate = body.estimate;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!estimate.groups.some((g) => g.items.length > 0)) {
    return NextResponse.json({ error: "empty_estimate" }, { status: 400 });
  }

  const standard = recalcEstimate(estimate);
  const standardVariant: TierVariant = { tier: "standard", name: standard.name, groups: standard.groups, totals: standard.totals };

  const comp = tierConfig("competitive");
  const prem = tierConfig("premium");
  const system = `You build pricing tiers for ${HONEYDONE.company}, a licensed and insured Florida property maintenance and repair contractor.

You are given the STANDARD build of a job. Produce two more tiers as build operations (add_group then add_line_item), each a complete standalone build:

COMPETITIVE: ${comp.guidance}
PREMIUM: ${prem.guidance}

HoneyDone pricing rules for every tier:
- Labor is costType Labor, unit HRS, unitCost ${HONEYDONE.laborRate}. The app keeps labor at 0% markup. Do not mark up labor.
- Materials are costType Material, unitCost is your cost. The app adds ${HONEYDONE.materialsMarkupPct}% for the client automatically. Use value-grade material costs for Competitive and upgraded costs for Premium.
- Keep the $${HONEYDONE.tripCharge} trip charge (one Other line named "Trip charge") in every tier.
- Mirror the Standard build's structure. Competitive should total clearly less than Standard, Premium clearly more.

Return both tiers, no prose.`;

  try {
    const out = await genTiers(system, standardContext(standard));
    if (out) {
      const competitive = buildVariant(standard, out.competitive, "competitive");
      const premium = buildVariant(standard, out.premium, "premium");
      const safe = (v: TierVariant, fallbackTier: "competitive" | "premium") =>
        v.groups.some((g) => g.items.length > 0)
          ? v
          : deterministicTiers(estimate).find((d) => d.tier === fallbackTier)!;
      const tiers: TierVariant[] = [safe(competitive, "competitive"), standardVariant, safe(premium, "premium")];
      return NextResponse.json({ tiers, engine: "ai" });
    }
  } catch {
    /* model down or bad reply, fall through to deterministic */
  }
  return NextResponse.json({ tiers: deterministicTiers(estimate), engine: "fallback" });
}
