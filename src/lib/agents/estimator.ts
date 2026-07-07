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
import { cleanTaskName } from "../rateBook";
import { applyOperation } from "../operations";
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

// Intent detection so we lay in rate-book tasks deterministically on edits,
// instead of trusting a local model to emit the structured add. ADD without an
// EDIT/question word, plus a rate-book match, means "just add this known task".
const ADD_INTENT = /\b(add|also|include|throw in|toss in|put in|plus|need)\b/i;
const EDIT_INTENT = /\b(remove|delete|drop|take off|get rid|change|edit|update|swap|lower|raise|reduce|increase|discount|how much|why|what|when|which)\b|\?/i;

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
  // Card price + Max Guarantee live in the header (single source). Chat quotes
  // only the expected cash so it can't show a second, conflicting card number.
  let closing = `\n\nDone. Expected price $${q.cash} from your rate book. The Smooth and Max prices, with the card price, are up top.`;
  if (q.unmatched.length > 0)
    closing += ` This quote is INCOMPLETE: ${q.unmatched.map((u) => u.text).join(", ")} ${q.unmatched.length === 1 ? "is" : "are"} not in your book, so ${q.unmatched.length === 1 ? "it was" : "they were"} left out of the price. Add ${q.unmatched.length === 1 ? "it" : "them"} by hand or reword, and do not send this until that scope is priced.`;
  yield* streamText(closing);
  yield { type: "summary", name: estimateName };
  yield { type: "milestone", text: "Priced from your rate book" };
  yield { type: "suggestions", suggestions: ["Add a Complications Cap", "Add cleanup & haul-off", "Generate Jobber quote", "Finalize estimate"] };
}

/** Append rate-book-known tasks to an EXISTING quote, deterministically. No model,
 * so a known task like "lint vent cleaning" lands every time regardless of the brain. */
async function* rateBookAppend(jobText: string, estimate: Estimate): AsyncGenerator<EngineDelta> {
  const q = getRateBookEngine().quote(jobText);
  const existing = new Set(estimate.groups.flatMap((g) => g.items.map((i) => i.name.toLowerCase().trim())));
  const toAdd = q.lines.filter((l) => !/trip (fee|charge)/i.test(l.task) && !existing.has(l.task.toLowerCase().trim()));

  if (toAdd.length === 0) {
    const already = q.lines.length > 0 ? " Those tasks are already on the quote." : "";
    yield* streamText(`I could not find a new rate-book task to add.${already}`);
    if (q.unmatched.length > 0) yield* streamText(` Not in your book yet: ${q.unmatched.map((u) => u.text).join(", ")}.`);
    return;
  }

  const groupsPresent = new Set(estimate.groups.map((g) => g.name));
  const created = new Set<string>();
  for (const line of toAdd) {
    const group = line.category || "Additional Work";
    if (!groupsPresent.has(group) && !created.has(group)) {
      created.add(group);
      yield { type: "operation", operation: { op: "add_group", name: group } };
      await sleep(50);
    }
    yield {
      type: "operation",
      operation: { op: "add_line_item", groupName: group, name: line.task, quantity: line.qty, unit: mapUnit(line.unit), unitCost: line.unitPrice, costType: "Other" },
    };
    await sleep(60);
  }

  const names = toAdd.map((l) => l.task).join(", ");
  yield* streamText(`Added ${names} from your rate book at your flat rate${toAdd.length === 1 ? "" : "s"}.`);
  if (q.unmatched.length > 0) yield* streamText(` I could not match: ${q.unmatched.map((u) => u.text).join(", ")}. Those aren't in your book yet.`);
  yield { type: "summary", name: estimate.name };
}

// Words in a model reply that claim the estimate was changed. If the reply says
// one of these but no operation actually mutates anything, the reply is a lie
// and we refuse to stream it (the "chat confirms edits that never save" bug).
const CLAIMS_CHANGE = /\b(added|adding|removed|removing|deleted|deleting|dropped|changed|changing|updated|updating|swapped|swapping|replaced|replacing|set|lowered|raised|reduced|increased|adjusted|applied|discounted)\b/i;

/** One human-readable line per change record, for the confirmation message. */
function describeChange(c: { itemName: string; field: string; before: string; after: string }): string {
  if (c.field === "added") return `added ${c.itemName} (${c.after})`;
  if (c.field === "removed") return `removed ${c.itemName}`;
  return `${c.itemName}: ${c.field} ${c.before} to ${c.after}`;
}

/**
 * Dry-run the model's operations against the current estimate and keep only the
 * ones that really mutate something. An edit or delete aimed at an id that does
 * not exist produces zero change records; passing it through would let the model
 * confirm an edit that never lands. add_group and finalize are structural and
 * kept as-is.
 */
function verifyOperations(estimate: Estimate, rawOps: unknown[]): { verified: Operation[]; summaries: string[] } {
  const verified: Operation[] = [];
  const summaries: string[] = [];
  let sim = estimate;
  for (const raw of rawOps) {
    const op = normalizeOperation(raw);
    if (!op) continue;
    const res = applyOperation(sim, op);
    const structural = op.op === "add_group" || op.op === "finalize";
    if (res.changes.length === 0 && !structural) continue; // no-op, drop it
    sim = res.estimate;
    verified.push(op);
    for (const c of res.changes) summaries.push(describeChange(c));
  }
  return { verified, summaries };
}

/**
 * Honest no-match message for a requested change that could not be applied.
 * Instead of going quiet (or worse, claiming success), tell the user exactly
 * what we do and don't have in the rate book, e.g. the repair vs replace gap.
 */
function honestMiss(message: string): string {
  const base = "I could not apply that change, so the estimate is untouched.";
  try {
    const m = getRateBookEngine().match(message);
    if (m.lines.length > 0) {
      const l = m.lines[0];
      return `${base} Closest rate in your book is ${l.task} at $${l.unitPrice} per ${l.unit}. Want me to use that rate, or add a new one to the book?`;
    }
    const sug = Array.from(new Set(m.unmatched.flatMap((u) => u.suggestions))).slice(0, 3);
    if (sug.length > 0) {
      return `${base} I don't have a rate for that in your rate book. Closest tasks I do have: ${sug.join(", ")}. Want me to use one of those, or add a new rate?`;
    }
  } catch {
    /* rate book unavailable, fall through to the generic message */
  }
  return `${base} Point me at the exact line (its name or price) and tell me what it should say, or give me a price to use.`;
}

// "Set everything as repair" / "replace it all" style bulk conversions.
// Handled deterministically from the rate book, no model in the loop, so the
// conversion always lands or the user hears exactly which lines have no rate.
const BULK_SCOPE = /\b(all|everything|every\s+(line|item)|whole\s+(quote|estimate)|nothing)\b/i;
const TO_REPAIR = /\b(as|to|into|be)\s+repairs?\b|\brepairs?\s+(work|only|instead)\b|\b(nothing|not|don'?t|no)\b[^.]*\breplac/i;
const TO_REPLACE = /\b(as|to|into|be)\s+replace(ment)?s?\b|\breplace\s+(only|instead)\b|\b(nothing|not|don'?t|no)\b[^.]*\brepair/i;

/** Which tier a bulk-conversion request points at, or null if it isn't one. */
export function bulkTierTarget(message: string): "Repair" | "Replace" | null {
  const m = message || "";
  if (!BULK_SCOPE.test(m)) return null;
  const toRepair = TO_REPAIR.test(m) || (/\brepair/i.test(m) && !/\breplac/i.test(m));
  const toReplace = TO_REPLACE.test(m) || (/\breplac/i.test(m) && !/\brepair/i.test(m));
  if (toRepair && !toReplace) return "Repair";
  if (toReplace && !toRepair) return "Replace";
  // Both words present ("nothing replaced, everything as repair"): trust the
  // explicit "as/to X" phrasing when only one side has it.
  if (TO_REPAIR.test(m) && !TO_REPLACE.test(m)) return "Repair";
  if (TO_REPLACE.test(m) && !TO_REPAIR.test(m)) return "Replace";
  return null;
}

/** Convert every line to its rate-book sibling on the requested tier. Lines with
 * no priced sibling are left alone and named honestly in the reply. */
async function* bulkTierSwap(estimate: Estimate, to: "Repair" | "Replace"): AsyncGenerator<EngineDelta> {
  const eng = getRateBookEngine();
  const converted: string[] = [];
  const skipped: string[] = [];
  const ops: Operation[] = [];
  for (const g of estimate.groups) {
    for (const it of g.items) {
      if (/\btrip\b/i.test(it.name)) continue; // service fee, not a tiered task
      const sib = eng.tierSibling(it.name, to);
      if (sib && sib.final_price != null && sib.final_price > 0) {
        const newName = cleanTaskName(sib.name);
        ops.push({ op: "edit_line_item", id: it.id, field: "name", value: newName });
        if (it.unitCost !== sib.final_price) ops.push({ op: "edit_line_item", id: it.id, field: "unitCost", value: sib.final_price });
        converted.push(`${it.name} is now ${newName} at $${sib.final_price}`);
      } else {
        const otherTier = to === "Repair" ? /\breplace\b/i : /\brepair\b/i;
        if (otherTier.test(it.name)) skipped.push(it.name);
      }
    }
  }

  if (ops.length === 0) {
    const what = skipped.length ? skipped.join(", ") : "these lines";
    yield* streamText(
      `I could not convert anything, so the estimate is untouched. Your rate book has no ${to.toLowerCase()} rate for ${what}. Want me to add ${to.toLowerCase()} rates to the book, or set prices by hand?`
    );
    return;
  }

  for (const op of ops) {
    yield { type: "operation", operation: op };
    await sleep(40);
  }
  let msg = `Done, switched ${converted.length} line${converted.length === 1 ? "" : "s"} to ${to.toLowerCase()} rates: ${converted.join("; ")}.`;
  if (skipped.length > 0) {
    msg += ` No ${to.toLowerCase()} rate in your book for ${skipped.join(", ")}, so those are unchanged. Want me to add ${to.toLowerCase()} rates for them, or price them by hand?`;
  }
  yield* streamText(msg);
  yield { type: "summary", name: estimate.name };
}

export interface EstimatorArgs {
  message: string;
  estimate: Estimate;
  visionText?: string;
  /** learnedRates + priced-book text appended to the system prompt. */
  systemExtra?: string;
  /** Exact local model tag for this turn (two-stage brain: gemma on the first
   * prompt of a quote, qwen after). Undefined on Claude, which picks its own. */
  model?: string;
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

/** Diagnostic / troubleshooting intent: the customer wants us to find or figure
 *  out an unknown cause, not do a named replace or install. When true we skip the
 *  deterministic rate-book fast path (which grabs a Replace price) and let the
 *  model lead with a diagnostic line plus a conditional repair in the cap. */
const DIAGNOSTIC_INTENT =
  /\b(diagnos\w*|troubleshoot\w*|figure out (?:why|what)|find (?:out )?(?:where|why|the source|the leak|the cause)|what(?:'s| is) wrong|why (?:is|does|do|are|won'?t|it|my|the|this|that)|won'?t (?:turn|start|drain|heat|cool|latch|open|close|run)|keeps? running|running (?:by itself|on its own)|take a look|look at (?:it|this|what)|check (?:out |on )?(?:why|what|it)|not sure what|can'?t tell|what it needs)\b/i;
const HARD_SCOPE = /\b(replace|replacing|reinstall|install|installing)\b/i;

/** Fires when the request is asking for diagnosis, not a named replace/install. */
export function diagnosticIntent(text: string): boolean {
  if (!text.trim()) return false;
  return DIAGNOSTIC_INTENT.test(text) && !HARD_SCOPE.test(text);
}

/** The estimator does its job and streams EngineDeltas. */
export async function* runEstimator(args: EstimatorArgs): AsyncGenerator<EngineDelta> {
  const hasItems = args.estimate.groups.some((g) => g.items.length > 0);
  const combined = (args.visionText ? `${args.message} ${args.visionText}` : args.message).trim();

  // Fresh job that the rate book knows: price it flat, no model call.
  // Diagnostic/troubleshooting requests skip this so they are not grabbed as a
  // Replace price; they fall to the model, which leads with a diagnostic line
  // and parks the likely repair in the Complications Cap.
  if (!hasItems && !diagnosticIntent(combined) && rateBookMatches(combined)) {
    yield* rateBookBuild(combined, args.estimate.name);
    return;
  }

  // Add-to-existing of tasks the rate book already knows: lay them in directly,
  // no reliance on the local model emitting a structured edit.
  if (hasItems && ADD_INTENT.test(combined) && !EDIT_INTENT.test(combined) && !diagnosticIntent(combined) && rateBookMatches(combined)) {
    yield* rateBookAppend(combined, args.estimate);
    return;
  }

  // Bulk repair/replace conversion ("set everything as repair"): deterministic,
  // straight from the rate book, so it can never silently do nothing.
  const bulkTo = hasItems ? bulkTierTarget(args.message) : null;
  if (bulkTo) {
    yield* bulkTierSwap(args.estimate, bulkTo);
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
      model: args.model,
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
  const rawOps = Array.isArray(result.operations) ? result.operations : [];

  // Verification gate (Bug 1). Dry-run every operation against the current
  // estimate BEFORE saying anything. The confirmation the user reads is built
  // from the real mutation results, never from the model's own claim.
  const { verified, summaries } = verifyOperations(args.estimate, rawOps);

  if (verified.length === 0) {
    const wantedChange = EDIT_INTENT.test(args.message) || ADD_INTENT.test(args.message);
    if (CLAIMS_CHANGE.test(reply) || (wantedChange && rawOps.length > 0)) {
      // The model said it changed something (or tried to and missed). Nothing
      // actually changed, so say that instead of streaming the phantom success.
      yield* streamText(honestMiss(args.message));
    } else {
      // A genuine question or answer that changes nothing. Stream it as-is.
      yield* streamText(reply || "The estimator got a reply it could not read. Try rewording the request.");
    }
    return;
  }

  let applied = 0;
  for (const op of verified) {
    yield { type: "operation", operation: op };
    applied++;
    await sleep(40);
  }

  // Confirmation generated from what actually changed, not the model's prose.
  if (summaries.length > 0) {
    const shown = summaries.slice(0, 6).join("; ");
    const more = summaries.length > 6 ? ` and ${summaries.length - 6} more` : "";
    yield* streamText(`Done, ${summaries.length} change${summaries.length === 1 ? "" : "s"}: ${shown}${more}. The diff below shows old vs new, and the estimate tab matches it.`);
  } else if (reply) {
    yield* streamText(reply);
  }

  // Fresh build that produced lines gets the same finish polish as the fast path.
  if (!hasItems && applied > 0) {
    if (args.message.trim()) yield { type: "name", name: deriveJobName(args.message) };
    yield { type: "summary", name: args.estimate.name };
    yield { type: "milestone", text: "Built on your local model" };
    yield { type: "suggestions", suggestions: ["Add a Complications Cap", "Add cleanup & haul-off", "Generate Jobber quote", "Finalize estimate"] };
  }
}
