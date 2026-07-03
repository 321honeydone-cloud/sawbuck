// Pricing Research employee, the crew's market scout.
//
// Uses Claude's built-in web_search tool (a server-side tool that runs on
// Anthropic's end) to find what a homeowner actually pays for a task right now,
// scoped to the contractor's region. Returns a structured price the Estimator
// can lean on for work the rate book has no price for yet. Cloud-only: if the
// brain is Ollama (no web search), every call returns null and the crew simply
// carries on without it. Server-only.

import { makeAnthropic } from "../anthropic";
import { activeProvider, CLAUDE_TEXT_MODEL, parseLooseJson } from "./client";

export interface PriceFinding {
  task: string;
  unit: string; // friendly: each / sq ft / linear ft / hour / lump sum
  low: number;
  median: number;
  high: number;
  basis: string;
  sources: string[];
}

const PRICING_SYSTEM = `You are the Pricing Research employee for HoneyDone, an insured Florida handyman and property maintenance service (not a licensed contractor). Use web search to find what a homeowner actually pays in 2026 for the work, focused on Florida and the Southeast US. Prefer cost-estimate sites like Homewyse, Fixr, HomeGuide, and Angi, and back them up with contractor forums like Reddit and ContractorTalk for real numbers. Report the ALL-IN installed price the customer pays, not just materials. No em dashes and no semicolons.`;

/** Research one task. Returns null when the cloud brain is off or nothing solid was found. */
export async function researchPrice(task: string, location = "Florida"): Promise<PriceFinding | null> {
  // Pricing research uses Claude web search, so it MUST respect the brain toggle.
  // In Local mode we skip it entirely and return null (the crew carries on with
  // the rate book), so quoting never silently hits the paid Claude API.
  if ((await activeProvider()) !== "claude") return null;
  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key) return null;
  const client = makeAnthropic(key);
  const prompt = `Find the current all-in installed price for this work in ${location}: "${task}".
Search the web, then answer with ONLY one JSON object and nothing else:
{"task":"short task name","unit":"each|sq ft|linear ft|hour|lump sum","low":number,"median":number,"high":number,"basis":"one short line, for example installed price in Florida 2026","sources":["url","url"]}
Numbers are US dollars per unit. If you cannot find solid numbers, set median to 0.`;
  try {
    const resp = await client.messages.create({
      model: CLAUDE_TEXT_MODEL,
      max_tokens: 1024,
      system: PRICING_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as never],
    });
    const text = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const parsed = parseLooseJson<PriceFinding>(text);
    if (!parsed || !(Number(parsed.median) > 0)) return null;
    return {
      task: (parsed.task || task).trim(),
      unit: parsed.unit || "each",
      low: Number(parsed.low) || 0,
      median: Number(parsed.median) || 0,
      high: Number(parsed.high) || 0,
      basis: (parsed.basis || "").trim(),
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 5).map(String) : [],
    };
  } catch {
    return null;
  }
}

/** Research several tasks at once (capped), dropping the ones that came back empty. */
export async function researchPrices(tasks: string[], location = "Florida", max = 6): Promise<PriceFinding[]> {
  const picks = tasks.map((t) => t.trim()).filter(Boolean).slice(0, max);
  if (picks.length === 0) return [];
  const out = await Promise.all(picks.map((t) => researchPrice(t, location)));
  return out.filter((x): x is PriceFinding => x !== null);
}

/** Render findings as a block appended to the Estimator's system prompt. */
export function formatFindingsForPrompt(findings: PriceFinding[]): string {
  if (findings.length === 0) return "";
  const lines = findings.map(
    (f) => `- ${f.task}: median $${f.median} per ${f.unit}, range $${f.low} to $${f.high}. ${f.basis}`.trim()
  );
  return `\n\nMARKET PRICING (researched live just now, use these for any task the rate book does not already price):\n${lines.join("\n")}`;
}
