// Learning health for the Admin page: is Sawbuck actually getting smarter from
// the quotes going through it? Reads the live database and the memory file and
// answers in plain words. Admin only.
//
// GET  -> counts, top learned prices, memory state, and a list of verdicts.
// POST { action: "compact" } -> distill the memory log into lessons right now.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { RATEBOOK_ID, parseRateBook } from "@/lib/rates";
import { OVERRIDES_ID, parseOverrides } from "@/lib/rateOverrides";
import { sampleStats } from "@/lib/priceSamples";
import { compactNow, memoryStats } from "@/lib/memory";
import { activeProvider } from "@/lib/agents/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

type Level = "ok" | "warn" | "bad";

async function requireAdmin() {
  const s = await getSession();
  return s && s.role === "admin" ? s : null;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const since30 = new Date(Date.now() - 30 * DAY);

  // ----- Quotes -----
  const byStatusRows = await prisma.estimate.groupBy({ by: ["status"], _count: { _all: true } });
  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = r._count._all;
  const totalQuotes = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const last30 = await prisma.estimate.count({ where: { createdAt: { gte: since30 } } });
  const newest = await prisma.estimate.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });

  // ----- Learned rates (cost per unit, fed into every chat) -----
  const rateRow = await prisma.catalog.findUnique({ where: { id: RATEBOOK_ID } });
  const learned = parseRateBook(rateRow?.items).filter((r) => r.source !== "seed");
  const learned30 = learned.filter((r) => Date.parse(r.updatedAt) >= since30.getTime()).length;
  const multiJob = learned.filter((r) => sampleStats(r.samples).jobs >= 2).length;
  const wonBacked = learned.filter((r) => sampleStats(r.samples).won > 0).length;
  const topRates = learned
    .slice()
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 8)
    .map((r) => {
      const st = sampleStats(r.samples);
      return { name: r.name, unit: r.unit, costType: r.costType, price: r.unitCost, used: r.useCount, jobs: st.jobs, won: st.won, low: st.low, high: st.high };
    });

  // ----- Rate Book (all-in client prices) -----
  const ovRow = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
  const overrides = Object.values(parseOverrides(ovRow?.items));
  const fromQuotes = overrides.filter((o) => o.source === "quote");
  const rateBook = {
    fromQuotes: fromQuotes.length,
    newFromJobs: fromQuotes.filter((o) => o.isNew).length,
    fromQuotes30: fromQuotes.filter((o) => Date.parse(o.updatedAt) >= since30.getTime()).length,
    screenEdits: overrides.filter((o) => o.source === "screen").length,
    research: overrides.filter((o) => o.source === "research").length,
  };

  // ----- Memory -----
  let memory: Awaited<ReturnType<typeof memoryStats>> | null = null;
  try {
    memory = await memoryStats();
  } catch {
    memory = null;
  }
  const brain = await activeProvider();

  // ----- Verdicts, worst first -----
  const verdicts: { level: Level; text: string }[] = [];
  const drafts = byStatus.draft ?? 0;
  const finished = (byStatus.complete ?? 0) + (byStatus.sent ?? 0) + (byStatus.invoiced ?? 0);

  if (!memory) {
    verdicts.push({ level: "bad", text: "Can't read the memory file. Lessons are not being saved." });
  } else {
    if (memory.lastError && (!memory.lastCompactedAt || Date.parse(memory.lastErrorAt ?? "") > Date.parse(memory.lastCompactedAt))) {
      verdicts.push({ level: "bad", text: `Lessons are stuck. Last try failed: ${memory.lastError}` });
    } else if (memory.pending >= memory.compactEvery) {
      verdicts.push({ level: "warn", text: `${memory.pending} job events are waiting to be turned into lessons. Hit Distill now.` });
    }
    if (memory.logEntries === 0) {
      verdicts.push({
        level: "warn",
        text: "The memory log is empty. It only records a quote when you mark it Complete, Sent or Invoiced, delete it, or correct a known price.",
      });
    }
  }
  if (totalQuotes > 0 && finished === 0) {
    verdicts.push({
      level: "warn",
      text: `All ${drafts} quotes are still Draft. Mark jobs Sent or Invoiced so the memory logs them and won prices count triple.`,
    });
  } else if (finished > 0 && (byStatus.invoiced ?? 0) === 0) {
    verdicts.push({ level: "warn", text: "No quotes are marked Invoiced yet, so no price has the won-job boost." });
  }
  if (learned.length === 0) {
    verdicts.push({ level: "warn", text: "No learned rates yet. They start filling in as you edit or accept lines on a quote." });
  } else if (learned30 === 0) {
    verdicts.push({ level: "warn", text: "No prices learned in the last 30 days." });
  } else {
    verdicts.push({ level: "ok", text: `${learned30} ${learned30 === 1 ? "price" : "prices"} learned or updated in the last 30 days.` });
  }
  if (memory && memory.lessons > 0 && memory.lastCompactedAt && !verdicts.some((v) => v.level === "bad")) {
    verdicts.push({ level: "ok", text: `${memory.lessons} ${memory.lessons === 1 ? "lesson rides" : "lessons ride"} along on every quote.` });
  }
  const rank: Record<Level, number> = { bad: 0, warn: 1, ok: 2 };
  verdicts.sort((a, b) => rank[a.level] - rank[b.level]);

  return NextResponse.json({
    brain,
    quotes: { total: totalQuotes, byStatus, last30, lastActivity: newest?.updatedAt ?? null },
    learnedRates: { total: learned.length, last30: learned30, multiJob, wonBacked, top: topRates },
    rateBook,
    memory,
    verdicts,
  });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let action = "";
  try {
    action = String(((await req.json()) as { action?: string }).action ?? "");
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (action !== "compact") return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  try {
    await compactNow();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
