// POST /api/jobber/chat. The Inspector chat box under the notes on the push
// result sheet. Headless Claude with the two Zapier Jobber actions as its only
// tools. Reads run live. A safe_update comes back as a PROPOSAL with a before
// and after diff and nothing writes until /api/jobber/approve. Owner only.

import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/session";
import { healerChat, type HealerTurn } from "@/lib/agents/healer";
import { buildExpectedPush } from "@/lib/jobberPush/expected";
import { readSendLog } from "@/lib/jobberPush/sendLog";
import { playbookStore, prismaSettings, transport } from "@/lib/jobberPush/server";
import type { JobberQuoteRead, PushResult } from "@/lib/jobberPush/types";
import type { Estimate } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  message?: string;
  history?: HealerTurn[];
  estimate?: Estimate;
  quoteRef?: string;
  quote?: { quoteTitle?: string; scopeOfWork?: string };
  exclusions?: string[];
  lastPush?: PushResult | null;
  readBack?: JobberQuoteRead | null;
  inspectorNotes?: string;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!isAdmin(session)) return NextResponse.json({ error: "owner_only" }, { status: 403 });
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json({ error: "no_claude", message: "The inspector chat runs on Claude. Add ANTHROPIC_API_KEY to .env." }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message || !body.estimate || !body.quoteRef) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const expected =
    body.lastPush?.expected ??
    buildExpectedPush(body.estimate, {
      title: String(body.quote?.quoteTitle ?? body.estimate.name ?? ""),
      scopeOfWork: String(body.quote?.scopeOfWork ?? ""),
      exclusions: Array.isArray(body.exclusions) ? body.exclusions.map(String) : [],
    });
  const readBack = body.readBack ?? body.lastPush?.readBack ?? null;
  const [playbook, sendLog, taxRateId] = await Promise.all([
    playbookStore.load(),
    readSendLog({ estimateId: body.estimate.id }, 60),
    prismaSettings.getTaxRateId(),
  ]);

  try {
    const out = await healerChat(
      {
        quoteRef: body.quoteRef,
        quoteId: body.lastPush?.quoteId ?? readBack?.id ?? null,
        expected,
        readBack,
        lastPush: body.lastPush ?? null,
        sendLog: sendLog.length ? sendLog : body.lastPush?.log ?? [],
        playbook,
        inspectorNotes: body.inspectorNotes,
        taxRateId,
      },
      Array.isArray(body.history) ? body.history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string") : [],
      message,
      transport(),
      apiKey
    );
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: "chat_failed", message: (err as Error).message }, { status: 500 });
  }
}
