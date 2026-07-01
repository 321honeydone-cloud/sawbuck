// HoneyDone Jobber quote generator — turns an internal estimate into the
// client-facing fields Manny pastes into Jobber. Rules come straight from the
// honeydone-jobber-quote skill: one consolidated scope paragraph, no hourly
// math, no markup, no internal pricing logic, no em dashes, always the closing
// line, at least two exclusions.

import type { Estimate } from "./types";
import { HONEYDONE, cardPrice } from "./honeydone";
import { tierConfig } from "./tiers";

export interface JobberQuote {
  client: string;
  quoteTitle: string;
  lineItemName: string;
  scopeOfWork: string;
  priceCash: number;
  priceCard: number;
  exclusions: string[];
}

export const EXCLUSIONS_BANK = [
  "Hidden rot, water damage, or structural deterioration found during or after demo is not included and will require a separate estimate before work continues",
  "Mold remediation is not included. Florida law requires a licensed mold remediator for affected areas greater than 10 sq ft. Referrals available upon request.",
  "Permit fees unless explicitly stated in scope",
  "Plumbing repairs or modifications",
  "Electrical work",
  "Matching of existing materials (tile, paint, trim) cannot be guaranteed without manufacturer specifications",
  "Work on surfaces or areas not listed in scope",
  "Haul-away or disposal unless explicitly included in scope",
  "Painting or priming of new materials unless explicitly included",
  "Soffit, fascia, or roofline work unless explicitly included",
];

export const JOBBER_SYSTEM = `You write client-facing quote fields for ${HONEYDONE.company}, a licensed and insured Florida property maintenance and repair contractor.

Turn the internal estimate below into Jobber-ready fields. You produce the wording only. Prices are handled separately, do not invent or mention dollar amounts.

Hard rules:
- One consolidated SCOPE OF WORK paragraph. Never sub-bullets, never numbered steps, never a line-item breakdown.
- Never reveal hourly labor, markup, material cost, or any internal pricing logic.
- No em dashes and no semicolons. Use commas, periods, or parentheses.
- Describe WHAT gets done and the END RESULT the client gets. Name materials by type where relevant (PVC, epoxy grout, composite, commercial silicone). Mention demo, prep, and cleanup as part of scope when they apply.
- Confident and professional, like someone who has done this a hundred times. Never apologetic about price.
- End the scope paragraph with this exact closing line: "${HONEYDONE.closingLine}"

Fields:
- quoteTitle: 4 to 8 words, professional, describes the job.
- lineItemName: a single label, 4 to 8 words.
- scopeOfWork: the consolidated paragraph described above, ending with the closing line.
- exclusions: at least two relevant items. Pull from the standard bank when they fit, or write equivalents in the same voice.

Emit your answer through the emit_jobber_quote tool.`;

export function jobberUserTurn(estimate: Estimate): string {
  const lines: string[] = [
    `Job: ${estimate.name} (${estimate.location ?? "Florida"}).`,
  ];
  if (estimate.selectedTier) {
    const t = tierConfig(estimate.selectedTier);
    lines.push(`Service tier: ${t.label}. ${t.guidance}`);
  }
  lines.push(
    "Work included (for your understanding only, do not list these as bullets or mention quantities as line items):"
  );
  for (const g of estimate.groups) {
    const items = g.items.map((i) => i.name).join(", ");
    if (items) lines.push(`- ${g.name}: ${items}`);
  }
  return lines.join("\n");
}

export const EMIT_JOBBER_TOOL = {
  name: "emit_jobber_quote",
  description: "Return the client-facing Jobber quote fields.",
  input_schema: {
    type: "object" as const,
    properties: {
      quoteTitle: { type: "string" },
      lineItemName: { type: "string" },
      scopeOfWork: { type: "string", description: "One consolidated paragraph ending with the closing line." },
      exclusions: { type: "array", items: { type: "string" }, minItems: 2 },
    },
    required: ["quoteTitle", "lineItemName", "scopeOfWork", "exclusions"],
  },
};

/** Attach correct prices and guarantee the closing line is present. */
export function finalizeQuote(
  estimate: Estimate,
  parts: { quoteTitle: string; lineItemName: string; scopeOfWork: string; exclusions: string[] }
): JobberQuote {
  let scope = parts.scopeOfWork.trim().replace(/\s*[—–]\s*/g, ", ");
  if (!scope.includes(HONEYDONE.glPolicy)) {
    scope = `${scope} ${HONEYDONE.closingLine}`;
  }
  const exclusions = parts.exclusions.length >= 2 ? parts.exclusions : EXCLUSIONS_BANK.slice(0, 2);
  const cash = estimate.totals.estimateTotal;
  return {
    client: estimate.clientName?.trim() || "[Client name]",
    quoteTitle: parts.quoteTitle,
    lineItemName: parts.lineItemName,
    scopeOfWork: scope,
    priceCash: cash,
    priceCard: cardPrice(cash),
    exclusions,
  };
}

/** Deterministic fallback used when no API key is configured. */
export function deterministicQuote(estimate: Estimate): JobberQuote {
  const trades = estimate.groups.map((g) => g.name.toLowerCase());
  const scopeBits = estimate.groups
    .map((g) => {
      const names = g.items
        .filter((i) => i.costType !== "Other")
        .map((i) => i.name.toLowerCase())
        .slice(0, 4)
        .join(", ");
      return names ? `${g.name.toLowerCase()} (${names})` : g.name.toLowerCase();
    })
    .join(", ");
  const scope =
    `Complete ${estimate.name.toLowerCase()} as scoped. Work covers ${scopeBits || "the items listed"}. ` +
    `All demo, prep, and cleanup are included and the work area is left clean with debris removed. ` +
    HONEYDONE.closingLine;

  const exclusions = [...EXCLUSIONS_BANK];
  const picked: string[] = [exclusions[0]];
  if (!trades.some((t) => /permit/.test(t))) picked.push(exclusions[2]);
  if (!trades.some((t) => /paint/.test(t))) picked.push(exclusions[8]);
  if (picked.length < 2) picked.push(exclusions[6]);

  return finalizeQuote(estimate, {
    quoteTitle: estimate.name,
    lineItemName: estimate.name,
    scopeOfWork: scope,
    exclusions: picked.slice(0, 3),
  });
}
