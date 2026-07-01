// Client-facing Jobber quote fields, now on the local Estimator employee.
// Uses the local model when reachable, otherwise a deterministic fallback so the
// feature always works.
import { NextResponse } from "next/server";
import { genJobber } from "@/lib/agents/estimateExtras";
import { deterministicQuote, finalizeQuote } from "@/lib/jobber";
import type { Estimate } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/jobber, generate client-facing Jobber quote fields from an estimate.
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

  try {
    const fields = await genJobber(estimate);
    if (fields) {
      return NextResponse.json({ quote: finalizeQuote(estimate, fields), engine: "ai" });
    }
  } catch {
    /* model down or bad reply, fall through to deterministic */
  }
  return NextResponse.json({ quote: deterministicQuote(estimate), engine: "fallback" });
}
