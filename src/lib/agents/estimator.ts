// Estimator employee, the one who actually builds the quote.
//
// Two ways to work, just like before, only now the smart path runs on Manny's
// local model instead of Claude:
//   1. Rate-book fast path: a fresh job that matches the rate book is laid in at
//      flat prices, deterministic and instant. No model needed.
//   2. Model path: edits to an existing quote, or work the rate book can't match,
//      go to the local text model, which replies in prose and emits structured
//      operations the store applies. Steps, tiers, and Jobber wording are this
//      employee's other jobs (see steps/tiers/jobber helpers).
//
// Yields the same EngineDelta stream the UI already understands. Server-only.

import type { EngineDelta } from "../engine";
import { deriveJobName } from "../engine";
import type { Estimate, Operation, Unit } from "../types";
import { SYSTEM_PROMPT, estimateContext } from "../ai";
import { getRateBookEngine } from "../loadRateBook";
import { chatJson } from "./client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stream a string out as word-sized text deltas to mimic token streaming. */
async function* streamText(text: string): AsyncGenerator<EngineDelta> {
  for (const w of text.split(/(\s+)/)) {
    if (!w) continue;
    yield { type: "text", text: w };
    await sleep(14 + (w.length % 4) * 6);
  }
}

const UNITS: Unit[] = ["HRS", "EA", "LS", "SF", "LF", "SY", "CY", "DAY"];
const COST_TYPES = ["Labor", "Material", "Other"];
const EDIT_FIELDS = ["name", "quantity", "unit", "unitCost", "markupPct", "supplier", "costType"];

const UNIT_MAP: Record<string, Unit> = {
  each: "EA", ea: "EA", "per visit": "LS", visit: "LS", hour: "HRS", hr: "HRS",
  hours: "HRS", day: "DAY", "linear foot": "LF", "linear ft": "LF", lf: "LF",
  "square foot": "SF", "square feet": "SF", "sq ft": "SF", sf: "SF", sqft: "SF",
  "square yard": "SY", sy: "SY", "cubic yard": "CY", cy: "CY",
  "lump sum": "LS", ls: "LS", job: "LS",
  "per sq ft": "SF", "per square foot": "SF", "per linear foot": "LF",
  "per hour": "HRS", "per day": "DAY", "per sq yard": "SY", "per cubic yard": "CY",
};
const mapUnit = (u?: string): Unit => (u ? UNIT_MAP[u.toLowerCase().trim()] ?? "EA" : "EA");

/** Coerce a raw model object into a valid Operation, or null if unusable. */
export function normalizeOperation(raw: unknown): Operation | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const op = String(e.op ?? "");
  const num = (v: unknown, d = 0) => (isFinite(Number(v)) ? Number(v) : d);
  switch (op) {
    case "add_group":
      return e.name ? { op, name: String(e.name), position: e.position != null ? num(e.position) : undefined } : null;
    case "add_line_item": {
      // The name is the only hard requirement here. A missing groupName used to drop
      // the whole add silently (this was the "add did nothing" bug). Default it
      // instead so the line still lands; the apply layer creates the section.
      if (!e.name) return null;
      const groupName = e.groupName ? String(e.groupName) : "Additional Work";
      const unit = mapUnit(String(e.unit ?? ""));
      const costType = COST_TYPES.includes(String(e.costType)) ? (String(e.costType) as "Labor" | "Material" | "Other") : "Other";
      return {
        op,
        groupName,
        name: String(e.name),
        quantity: Math.max(0, num(e.quantity, 1)),
        unit,
        unitCost: Math.max(0, num(e.unitCost, 0)),
        costType,
        supplier: e.supplier == null ? null : String(e.supplier),
      };
    }
    case "edit_line_item": {
      if (!e.id || !EDIT_FIELDS.includes(String(e.field))) return null;
      const field = String(e.field) as keyof import("../types").LineItem;
      const value = typeof e.value === "number" ? e.value : String(e.value ?? "");
      return { op, id: String(e.id), field, value };
    }
    case "delete_line_item":
      return e.id ? { op, id: String(e.id) } : null;
    case "set_markup":
      return e.target ? { op, target: String(e.target), pct: num(e.pct) } : null;
    case "set_labor_rate":
      return { op, rate: num(e.rate) };
    case "finalize":
      return { op };
    default:
      return null;
  }
}

// JSON shape we ask the local model for. Flat and forgiving, normalized after.
const ESTIMATOR_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["add_group", "add_line_item", "edit_line_item", "delete_line_item", "set_markup", "set_labor_rate", "finalize"] },
          name: { type: "string" },
          groupName: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string", enum: UNITS },
          unitCost: { type: "number" },
          costType: { type: "string", enum: COST_TYPES },
          supplier: { type: ["string", "null"] },
          id: { type: "string" },
          field: { type: "string", enum: EDIT_FIELDS },
          value: { type: ["string", "number"] },
          target: { type: "string" },
          pct: { type: "number" },
          rate: { type: "number" },
          position: { type: "number" },
        },
        required: ["op"],
      },
    },
  },
  required: ["reply", "operations"],
};

/** Rate-book fast path: lay a matched job in at flat prices. Deterministic, free. */
async function* rateBookBuild(jobText: string, estimateName: string): AsyncGenerator<EngineDelta> {
  const q = getRateBookEngine().quote(jobText);
  yield* streamText(`Matched ${q.lines.length} ${q.lines.length === 1 ? "task" : "tasks"} in your rate book. Pricing at your flat rates.`);
  yield { type: "name", name: deriveJobName(jobText) };
  await sleep(150);

  const seen = new Set<string>();
  let tripMatched = false;
  for (const line of q.lines) {
    const group = line.category || "Service";
    if (!seen.has(group)) {
      seen.add(group);
      yield { type: "operation", operation: { op: "add_group", name: group } };
      await sleep(60);
    }
    if (/trip fee/i.test(line.task)) tripMatched = true;
    yield {
      type: "operation",
      operation: { op: "add_line_item", groupName: group, name: line.task, quantity: line.qty, unit: mapUnit(line.unit), unitCost: line.unitPrice, costType: "Other" },
    };
    await sleep(70);
  }
  if (!tripMatched && q.lines.length > 0) {
    yield { type: "operation", operation: { op: "add_group", name: "Service" } };
    yield { type: "operation", operation: { op: "add_line_item", groupName: "Service", name: "Trip charge", quantity: 1, unit: "LS", unitCost: q.trip, costType: "Other" } };
  }

  await sleep(120);
  let closing = `\n\nDone. Flat-rate total $${q.cash} cash, $${q.card} card. The Rate Book panel up top has the same number.`;
  if (q.unmatched.length > 0) closing += ` I could not match: ${q.unmatched.map((u) => u.text).join(", ")}. Add those by hand or reword them.`;
  yield* streamText(closing);
  yield { type: "summary", name: estimateName };
  yield { type: "milestone", text: "Priced from your rate book" };
  yield { type: "suggestions", suggestions: ["Build 3 tiers", "Add cleanup & haul-off", "Generate Jobber quote", "Finalize estimate"] };
}

export interface EstimatorArgs {
  message: string;
  estimate: Estimate;
  visionText?: string;
  /** learnedRates + priced-book text appended to the system prompt. */
  systemExtra?: string;
}

/** True when a fresh job text matches enough rate-book tasks to quote directly. */
export function rateBookMatches(text: string): boolean {
  if (!text.trim()) return false;
  try {
    return getRateBookEngine().match(text).lines.length > 0;
  } catch {
    return false;
  }
}

/** The estimator does its job and streams EngineDeltas. */
export async function* runEstimator(args: EstimatorArgs): AsyncGenerator<EngineDelta> {
  const hasItems = args.estimate.groups.some((g) => g.items.length > 0);
  const combined = (args.visionText ? `${args.message} ${args.visionText}` : args.message).trim();

  // Fresh job that the rate book knows: price it flat, no model call.
  if (!hasItems && rateBookMatches(combined)) {
    yield* rateBookBuild(combined, args.estimate.name);
    return;
  }

  // Otherwise think it through on the local model.
  const system = SYSTEM_PROMPT + (args.systemExtra ?? "");
  const attachNote = args.visionText ? `\n\nVision employee read the attachments and saw: ${args.visionText}` : "";
  const example =
    'Worked example. If the user says "add gutter cleaning", a CORRECT response is exactly:\n' +
    '{"reply":"Added gutter cleaning.","operations":[{"op":"add_line_item","groupName":"Exterior","name":"Gutter cleaning","quantity":1,"unit":"LS","unitCost":150,"costType":"Labor","supplier":null}]}\n' +
    "The operations array is NOT empty in that example. Any time you tell the user you added, changed, or removed anything, operations MUST contain a matching entry, or nothing actually happens. Leave operations empty ONLY when the user asked a question that changes nothing.";
  const userTurn = `Current estimate state:\n${estimateContext(args.estimate)}${attachNote}\n\nUser request: ${args.message || "(see what the vision employee saw above)"}\n\n${example}\n\nNow handle the request. Reply in 1 to 3 short sentences AND put every change in the operations array, using real line item ids from the state above when editing. Respond as JSON with keys reply and operations.`;

  let result: { reply?: string; operations?: unknown[] } | null = null;
  try {
    result = await chatJson<{ reply?: string; operations?: unknown[] }>({
      system,
      prompt: userTurn,
      schema: ESTIMATOR_SCHEMA,
      temperature: 0.2,
    });
  } catch (err) {
    yield* streamText(`The estimator could not reach your local model. ${(err as Error).message}. Start Ollama and try again.`);
    return;
  }

  if (!result) {
    yield* streamText("The estimator got a reply it could not read. Try rewording the request.");
    return;
  }

  const reply = (result.reply ?? "").trim();
  if (reply) yield* streamText(reply);

  const ops = Array.isArray(result.operations) ? result.operations : [];
  let applied = 0;
  for (const raw of ops) {
    const op = normalizeOperation(raw);
    if (op) {
      yield { type: "operation", operation: op };
      applied++;
      await sleep(40);
    }
  }

  // Fresh build that produced lines gets the same finish polish as the fast path.
  if (!hasItems && applied > 0) {
    if (args.message.trim()) yield { type: "name", name: deriveJobName(args.message) };
    yield { type: "summary", name: args.estimate.name };
    yield { type: "milestone", text: "Built on your local model" };
    yield { type: "suggestions", suggestions: ["Build 3 tiers", "Add cleanup & haul-off", "Generate Jobber quote", "Finalize estimate"] };
  }
}
