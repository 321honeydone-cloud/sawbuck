// Scout — property inspection brain. Turns an inspector's photo + spoken note
// into a structured defect, and turns a set of defects into a priced estimate.
// Local-first: the AI call lives in /api/scout (Ollama). This file holds the
// vocabulary, the deterministic fallback, and the issue -> estimate mapping.

import { recalcEstimate } from "./totals";
import type { Estimate, Group, IssueSeverity, InspectionIssue, LineItem, MediaItem } from "./types";

export const SEVERITIES: IssueSeverity[] = ["critical", "major", "moderate", "minor"];

export const TRADES = [
  "Plumbing",
  "Electrical",
  "Roofing",
  "Drywall",
  "Carpentry",
  "HVAC",
  "Flooring",
  "Foundation",
  "Exterior",
  "Painting",
  "Appliances",
  "General",
] as const;

export const SCOUT_SYSTEM = `You are a property inspection assistant for a maintenance and repair contractor. You are given a photo of a defect and the inspector's spoken note about it. Return ONE issue as JSON with exactly these keys:
- trade: one of ${TRADES.join(", ")}
- severity: one of critical, major, moderate, minor
- defect: a short professional description of what is wrong (one sentence)
- risk: why it matters if left unaddressed (one sentence)
- recommendation: the repair or next step (one sentence)

Rules: respect the inspector. If they state a severity, use exactly that. Base the defect on what you see and what they said. Do not invent issues not mentioned or visible. No em dashes. Return only the JSON object.`;

/** Detect an explicitly stated severity in the narration. */
export function severityFromText(text: string): { severity: IssueSeverity; explicit: boolean } {
  const t = (text || "").toLowerCase();
  if (/\bcritical\b|\bemergency\b|\bhazard|\bunsafe\b|\bdanger/.test(t)) return { severity: "critical", explicit: true };
  if (/\bmajor\b/.test(t)) return { severity: "major", explicit: true };
  if (/\bmoderate\b/.test(t)) return { severity: "moderate", explicit: true };
  if (/\bminor\b|\bcosmetic\b/.test(t)) return { severity: "minor", explicit: true };
  if (/\bleak|\bmold\b|\brot\b|\bstructural\b|\bactive\b/.test(t)) return { severity: "major", explicit: false };
  return { severity: "moderate", explicit: false };
}

const TRADE_HINTS: [RegExp, string][] = [
  [/leak|water|plumb|faucet|toilet|drain|pipe|sink|valve|shower|tub/i, "Plumbing"],
  [/outlet|wire|electric|breaker|panel|gfci|light|switch|fixture/i, "Electrical"],
  [/roof|shingle|gutter|fascia|soffit|flashing|chimney/i, "Roofing"],
  [/drywall|crack|wall|ceiling|hole|nail pop|texture/i, "Drywall"],
  [/hvac|furnace|\bac\b|air condition|duct|thermostat|vent/i, "HVAC"],
  [/floor|tile|grout|laminate|vinyl|hardwood|carpet/i, "Flooring"],
  [/foundation|settle|footing|slab|crawl/i, "Foundation"],
  [/fence|deck|siding|stucco|exterior|paver|driveway/i, "Exterior"],
  [/paint|primer|stain/i, "Painting"],
  [/appliance|dishwasher|range|oven|microwave|dryer|washer|disposal|water heater/i, "Appliances"],
  [/door|window|trim|cabinet|fascia|framing|wood/i, "Carpentry"],
];

export function tradeFromText(text: string): string {
  for (const [re, trade] of TRADE_HINTS) if (re.test(text)) return trade;
  return "General";
}

/** Offline fallback: build a usable issue straight from the narration. */
export function deterministicIssue(transcript: string): Omit<InspectionIssue, "id" | "position"> {
  const note = (transcript || "").trim();
  const { severity, explicit } = severityFromText(note);
  const trade = tradeFromText(note);
  const defect = note ? note.charAt(0).toUpperCase() + note.slice(1) : "Issue noted during inspection";
  return {
    trade,
    severity,
    defect,
    risk: "May worsen and lead to further damage if left unaddressed.",
    recommendation: "Recommend repair by a qualified contractor.",
    transcript: note,
    inspectorSet: explicit,
  };
}

// ---------------------------------------------------------------------------
// Inspection -> estimate: each issue becomes a labor line (carrying the defect,
// risk, and recommendation) plus a material placeholder for manual pricing,
// grouped by trade. Matches the Scout-to-Jobber shape in the spec.
// ---------------------------------------------------------------------------

let iid = 0;
const nid = (p: string) => `${p}_ins${Date.now().toString(36)}${(iid++).toString(36)}`;

function mk(
  groupId: string,
  position: number,
  name: string,
  costType: LineItem["costType"],
  markupPct: number,
  notes: string | null,
  media?: MediaItem[]
): LineItem {
  return {
    id: nid("li"),
    groupId,
    position,
    name,
    quantity: 1,
    unit: "LS",
    unitCost: 0,
    costType,
    markupPct,
    supplier: costType === "Material" ? "Home Depot" : null,
    supplierPrice: null,
    notes,
    media: media && media.length ? media : undefined,
    builderCost: 0,
    markupAmount: 0,
    clientTotal: 0,
  };
}

export function issuesToEstimate(base: Estimate, issues: InspectionIssue[]): Estimate {
  const order: string[] = [];
  const byTrade = new Map<string, InspectionIssue[]>();
  for (const issue of issues) {
    const trade = issue.trade || "General";
    if (!byTrade.has(trade)) {
      byTrade.set(trade, []);
      order.push(trade);
    }
    byTrade.get(trade)!.push(issue);
  }

  const groups: Group[] = order.map((trade, gi) => {
    const gid = nid("grp");
    const items: LineItem[] = [];
    for (const issue of byTrade.get(trade)!) {
      const work = (issue.recommendation || issue.defect).trim();
      const notes = `Defect: ${issue.defect}. Severity: ${issue.severity}. Risk: ${issue.risk}. Recommendation: ${issue.recommendation}`;
      items.push(mk(gid, items.length + 1, work, "Labor", 0, notes, issue.media));
      items.push(mk(gid, items.length + 1, `Materials: ${work}`, "Material", 25, null));
    }
    return { id: gid, position: gi + 1, name: trade, items, subtotalBuilder: 0, subtotalClient: 0 };
  });

  return recalcEstimate({ ...base, groups });
}
