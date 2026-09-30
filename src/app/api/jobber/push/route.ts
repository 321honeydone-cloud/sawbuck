// POST /api/jobber/push. Update mode push to an existing draft Jobber quote:
// read, safe_update, read back, compare, self heal (max 2), then SENT or
// STOPPED with the whole story attached. Never creates a quote. Owner only.
//
// Body: { estimate, quoteRef, quote: { quoteTitle, scopeOfWork }, exclusions: string[],
//         simulateError?: string }
// simulateError hands a fake error (for example "Quote can't be blank") to the
// heal loop instead of running the first safe_update, so the playbook routing
// can be tested without touching Jobber.
//
// GET /api/jobber/push?estimateId=EST-1 returns the saved quote ref and the
// recent send log for that estimate.

import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/session";
import { pushUpdate } from "@/lib/jobberPush/push";
import { readSendLog } from "@/lib/jobberPush/sendLog";
import { getQuoteRef, playbookStore, prismaSettings, setQuoteRef, transport } from "@/lib/jobberPush/server";
import { logMemoryEvent } from "@/lib/memory";
import type { Estimate } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  estimate?: Estimate;
  quoteRef?: string;
  quote?: { quoteTitle?: string; scopeOfWork?: string };
  exclusions?: string[];
  simulateError?: string;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!isAdmin(session)) return NextResponse.json({ error: "owner_only" }, { status: 403 });
  const estimateId = new URL(req.url).searchParams.get("estimateId") ?? "";
  if (!estimateId) return NextResponse.json({ error: "missing_estimate" }, { status: 400 });
  const [quoteRef, log] = await Promise.all([getQuoteRef(estimateId), readSendLog({ estimateId }, 120)]);
  return NextResponse.json({ quoteRef, log });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!isAdmin(session)) return NextResponse.json({ error: "owner_only" }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const estimate = body.estimate;
  const quoteRef = String(body.quoteRef ?? "").trim();
  if (!estimate) return NextResponse.json({ error: "missing_estimate" }, { status: 400 });
  if (!quoteRef) return NextResponse.json({ error: "missing_quote_ref", message: "Update mode needs the Jobber quote number or web id." }, { status: 400 });

  const text = {
    title: String(body.quote?.quoteTitle ?? estimate.name ?? ""),
    scopeOfWork: String(body.quote?.scopeOfWork ?? ""),
    exclusions: Array.isArray(body.exclusions) ? body.exclusions.map(String) : [],
  };

  try {
    const result = await pushUpdate({
      estimate,
      text,
      quoteRef,
      transport: transport(),
      playbook: playbookStore,
      settings: prismaSettings,
      initialError: body.simulateError?.trim() || undefined,
    });
    await setQuoteRef(estimate.id, quoteRef).catch(() => {});
    if (result.status === "SENT") {
      void logMemoryEvent({
        kind: "sent",
        ref: estimate.id,
        title: estimate.name,
        lines: [`Pushed update to Jobber quote ${result.readBack?.quoteNumber ?? quoteRef} for ${result.readBack?.clientName ?? "client"}: subtotal $${result.expected.subtotal.toFixed(2)}, ${result.expected.lines.length} line(s), ${result.attempts.filter((a) => a.ran).length} self heal(s).`],
      });
    }
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: "push_failed", message: (err as Error).message }, { status: 500 });
  }
}
