// RateBook employee, the pricer.
//
// Takes a plain-English price instruction ("LVP install is $3.50 a square foot")
// plus a short list of candidate tasks the route narrowed down, and proposes
// structured rate-book edits. Runs on the local text model. The route still does
// the final validation against the real book before anything is saved.
// Server-only.

import { chatJson } from "./client";
import { UNIT_OPTIONS } from "../rateOverrides";

export interface RateCandidate {
  name: string;
  category: string;
  unit: string;
  current_price: number | null;
  needs_price: boolean;
}

export interface ProposedEdit {
  name: string;
  isNew?: boolean;
  category?: string;
  final_price: number;
  unit: string;
  labor_minutes?: number;
  material_allowance?: number;
  note?: string;
}

export interface RateProposal {
  reply: string;
  edits: ProposedEdit[];
}

const SYSTEM = `You price tasks in HoneyDone's rate book from plain English. The user tells you a price like "LVP flooring installation costs $3.50 a square foot" and you map it to the right rate-book task and set its price and unit.

Rules:
- Match to an existing candidate task by name when one fits. Copy that task name EXACTLY, character for character.
- "a square foot" or "per sqft" means unit "per sq ft". "a linear foot" means "per linear foot". "an hour" means "per hour". A flat job price with no per-unit wording means unit "each" or "lump sum".
- Only set isNew true (with a category) when no candidate is a reasonable match.
- Read prices as plain numbers, "$3.50" means 3.50.
- If the instruction names several jobs, return one edit per job.
- No em dashes and no semicolons in your reply. Keep it short.
- Always return the edits. Do not ask follow-up questions unless the instruction has no price at all.
- Respond as JSON with keys edits (array) and reply (one short sentence).`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          isNew: { type: "boolean" },
          category: { type: "string" },
          final_price: { type: "number" },
          unit: { type: "string", enum: UNIT_OPTIONS as unknown as string[] },
          labor_minutes: { type: "number" },
          material_allowance: { type: "number" },
          note: { type: "string" },
        },
        required: ["name", "final_price", "unit", "note"],
      },
    },
    reply: { type: "string" },
  },
  required: ["edits", "reply"],
};

/** Ask the local model for structured rate edits. Returns null if it can't. */
export async function proposeRateEdits(instruction: string, candidates: RateCandidate[]): Promise<RateProposal | null> {
  const candText = candidates.length
    ? candidates
        .map((c) => `- ${c.name} | ${c.category} | ${c.unit} | ${c.current_price == null ? "UNPRICED" : "$" + c.current_price}`)
        .join("\n")
    : "(no close matches in the book)";
  const prompt = `Instruction: ${instruction}\n\nCandidate tasks (name | category | unit | current price):\n${candText}`;

  const out = await chatJson<{ edits?: unknown[]; reply?: string }>({
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    temperature: 0.2,
  });
  if (!out) return null;
  const edits = (Array.isArray(out.edits) ? out.edits : []) as ProposedEdit[];
  return { reply: String(out.reply ?? ""), edits };
}
