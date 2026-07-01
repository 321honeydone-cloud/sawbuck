// Scheduled rate-book auto-fill. Researches market prices for unpriced stubs
// (mode "fill", run daily) or refreshes prices it set before (mode "correct",
// run weekly), and writes them into the overrides book. Reuses the live Pricing
// Research agent, so it needs the cloud brain (Claude web search). The engine
// guard still skips any task left without a price, so nothing bad leaks.
//
// Auth: header x-cron-key matching CRON_SECRET (for a scheduler), or an admin
// session (for the manual button on the Rate Book screen).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateBook } from "@/lib/loadRateBook";
import { OVERRIDES_ID, applyOverrides, parseOverrides, isPriced, rateBookCounts } from "@/lib/rateOverrides";
import { researchPrice, type PriceFinding } from "@/lib/agents/pricing";
import { saveResearchedPrices } from "@/lib/pricingStore";

export const runtime = "nodejs";
export const maxDuration = 300;

async function authorized(req: Request): Promise<boolean> {
  const key = req.headers.get("x-cron-key");
  if (key && process.env.CRON_SECRET && key === process.env.CRON_SECRET) return true;
  const s = await getSession();
  return s?.role === "admin";
}

// POST /api/cron/ratebook { mode?: "fill" | "correct", limit?: number }
export async function POST(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { mode?: string; limit?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body is fine, use defaults */
  }
  const mode = body.mode === "correct" ? "correct" : "fill";
  const limit = Math.max(1, Math.min(40, Number(body.limit) || 15));
  const location = "Florida";

  const ovRow = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
  const overrides = parseOverrides(ovRow?.items);

  let targets: string[] = [];
  if (mode === "fill") {
    const merged = applyOverrides(rateBook.tasks, overrides);
    targets = merged
      .filter((t) => !isPriced(t.final_price) && t.name && !/\btrip\b/i.test(t.name))
      .slice(0, limit)
      .map((t) => t.name);
  } else {
    targets = Object.values(overrides)
      .filter((o) => o.source === "research" && o.name)
      .slice(0, limit)
      .map((o) => o.name);
  }

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, mode, researched: 0, saved: 0, note: "nothing to do" });
  }

  // Research each target, then pin the finding's name to the exact book task so
  // it overwrites the stub instead of adding a near-duplicate.
  const results = await Promise.all(
    targets.map(async (name) => {
      const f = await researchPrice(name, location);
      return f && f.median > 0 ? ({ ...f, task: name } as PriceFinding) : null;
    })
  );
  const findings = results.filter((x): x is PriceFinding => x !== null);
  const saved = await saveResearchedPrices(findings);

  const afterRow = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
  const after = parseOverrides(afterRow?.items);
  const counts = rateBookCounts(applyOverrides(rateBook.tasks, after), after);

  return NextResponse.json({ ok: true, mode, researched: targets.length, saved, counts });
}
