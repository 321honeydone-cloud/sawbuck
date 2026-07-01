// The Estimator's other three jobs, all on the local text model:
//   genSteps  - ordered work steps + sizing rationale for one line
//   genTiers  - rebuild Competitive and Premium as build operations
//   genJobber - client-facing Jobber quote wording
// Each returns null when the model is unreachable or replies with junk, so the
// routes can fall back to their deterministic builders. Server-only.

import { chatJson } from "./client";
import { normalizeOperation } from "./estimator";
import { STEPS_SYSTEM, stepsUserTurn, type StepsResult } from "../steps";
import { JOBBER_SYSTEM, jobberUserTurn } from "../jobber";
import type { Estimate, LineItem, Operation } from "../types";

/** Ordered work steps + one-line rationale for a single estimate line. */
export async function genSteps(item: LineItem, estimateName: string): Promise<StepsResult | null> {
  const out = await chatJson<{ steps?: unknown[]; rationale?: string }>({
    system: STEPS_SYSTEM + "\nRespond as JSON with keys steps (array of short strings) and rationale (one short string).",
    prompt: stepsUserTurn(item, estimateName),
    schema: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" } }, rationale: { type: "string" } },
      required: ["steps"],
    },
    temperature: 0.4,
  });
  if (!out) return null;
  const steps = (Array.isArray(out.steps) ? out.steps : []).map((s) => String(s)).filter(Boolean);
  if (!steps.length) return null;
  return { steps, rationale: out.rationale ? String(out.rationale) : undefined };
}

const OP_ITEM_SCHEMA = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["add_group", "add_line_item"] },
    name: { type: "string" },
    groupName: { type: "string" },
    quantity: { type: "number" },
    unit: { type: "string", enum: ["HRS", "EA", "LS", "SF", "LF", "SY", "CY", "DAY"] },
    unitCost: { type: "number" },
    costType: { type: "string", enum: ["Labor", "Material", "Other"] },
    supplier: { type: ["string", "null"] },
    position: { type: "number" },
  },
  required: ["op"],
};

/** Competitive + Premium tiers as build operations, rebuilt from the Standard. */
export async function genTiers(
  system: string,
  standardContext: string
): Promise<{ competitive: Operation[]; premium: Operation[] } | null> {
  const out = await chatJson<{ competitive?: unknown[]; premium?: unknown[] }>({
    system: system + "\nRespond as JSON with keys competitive and premium, each an array of build operations.",
    prompt: standardContext,
    schema: {
      type: "object",
      properties: { competitive: { type: "array", items: OP_ITEM_SCHEMA }, premium: { type: "array", items: OP_ITEM_SCHEMA } },
      required: ["competitive", "premium"],
    },
    temperature: 0.4,
    timeoutMs: 180000,
  });
  if (!out) return null;
  const norm = (arr: unknown): Operation[] =>
    (Array.isArray(arr) ? arr : []).map(normalizeOperation).filter((o): o is Operation => o !== null);
  return { competitive: norm(out.competitive), premium: norm(out.premium) };
}

/** Client-facing Jobber quote fields from an internal estimate. */
export async function genJobber(
  estimate: Estimate
): Promise<{ quoteTitle: string; lineItemName: string; scopeOfWork: string; exclusions: string[] } | null> {
  const out = await chatJson<{ quoteTitle?: string; lineItemName?: string; scopeOfWork?: string; exclusions?: unknown[] }>({
    system: JOBBER_SYSTEM + "\nRespond as JSON with keys quoteTitle, lineItemName, scopeOfWork, and exclusions (array of strings).",
    prompt: jobberUserTurn(estimate),
    schema: {
      type: "object",
      properties: {
        quoteTitle: { type: "string" },
        lineItemName: { type: "string" },
        scopeOfWork: { type: "string" },
        exclusions: { type: "array", items: { type: "string" } },
      },
      required: ["quoteTitle", "lineItemName", "scopeOfWork", "exclusions"],
    },
    temperature: 0.5,
  });
  if (!out || !out.scopeOfWork) return null;
  const exclusions = (Array.isArray(out.exclusions) ? out.exclusions : []).map((e) => String(e)).filter(Boolean);
  return {
    quoteTitle: String(out.quoteTitle ?? estimate.name),
    lineItemName: String(out.lineItemName ?? estimate.name),
    scopeOfWork: String(out.scopeOfWork),
    exclusions,
  };
}
