// Per-line work steps + sizing rationale, now on the local Estimator employee.
// Falls back to the deterministic keyword steps if the local model is down.
import { NextResponse } from "next/server";
import { genSteps } from "@/lib/agents/estimateExtras";
import { deterministicSteps } from "@/lib/steps";
import type { LineItem } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/steps, ordered work steps + sizing rationale for one line item.
export async function POST(req: Request) {
  let item: LineItem;
  let estimateName = "this estimate";
  try {
    const body = (await req.json()) as { item?: LineItem; estimateName?: string };
    if (!body.item || !body.item.name) {
      return NextResponse.json({ error: "missing_item" }, { status: 400 });
    }
    item = body.item;
    if (body.estimateName) estimateName = body.estimateName;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const out = await genSteps(item, estimateName);
    if (out && out.steps.length) {
      return NextResponse.json({ steps: out.steps, rationale: out.rationale, engine: "ai" });
    }
  } catch {
    /* model down or bad reply, fall through to deterministic */
  }
  return NextResponse.json({ ...deterministicSteps(item), engine: "fallback" });
}
