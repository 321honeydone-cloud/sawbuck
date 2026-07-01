// Plain-English rate-book pricing, now on the local RateBook employee (no API).
// Narrows the 1,155-task book to a few candidates, the local model proposes
// structured edits, the route validates them against the real book before the
// screen confirms and saves.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aiReady } from "@/lib/agents/client";
import { proposeRateEdits, type RateCandidate } from "@/lib/agents/ratebook";
import { rateBook } from "@/lib/loadRateBook";
import { prisma } from "@/lib/db";
import { OVERRIDES_ID, UNIT_OPTIONS, applyOverrides, isPriced, parseOverrides } from "@/lib/rateOverrides";
import type { RateTask } from "@/lib/rateBook";

export const runtime = "nodejs";

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "with", "on", "in", "at",
  "is", "are", "be", "it", "that", "this", "per", "cost", "costs", "price",
  "priced", "charge", "each", "dollars", "dollar", "bucks", "i", "we", "my",
  "set", "make", "add", "put", "new", "install", "installation", "installed",
  "replace", "repair", "do", "should", "would", "about", "around",
]);

function toks(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Narrow the full book to the few most relevant rows for the prompt. */
function findCandidates(instruction: string, tasks: RateTask[], limit = 35): RateCandidate[] {
  const qset = new Set(toks(instruction));
  if (qset.size === 0) return [];
  const scored: { t: RateTask; score: number }[] = [];
  for (const t of tasks) {
    const nt = toks(t.name);
    if (nt.length === 0) continue;
    let overlap = 0;
    for (const w of nt) if (qset.has(w)) overlap++;
    if (!overlap) continue;
    const lname = t.name.toLowerCase();
    let phrase = 0;
    for (const w of qset) if (w.length > 3 && lname.includes(w)) phrase++;
    const score = overlap * 2 + phrase + overlap / nt.length;
    scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ t }) => ({
    name: t.name,
    category: String(t.category ?? ""),
    unit: String(t.unit ?? "each"),
    current_price: isPriced(t.final_price) ? (t.final_price as number) : null,
    needs_price: !isPriced(t.final_price),
  }));
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { instruction?: string };
  try {
    body = (await req.json()) as { instruction?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const instruction = (body.instruction ?? "").trim();
  if (!instruction) return NextResponse.json({ error: "missing_instruction" }, { status: 400 });

  if (!(await aiReady())) return NextResponse.json({ error: "ollama_down" }, { status: 503 });

  // Merge overrides so candidates reflect prices already set, then narrow.
  const row = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
  const overrides = parseOverrides(row?.items);
  const merged = applyOverrides(rateBook.tasks, overrides);
  const candidates = findCandidates(instruction, merged);

  let proposal;
  try {
    proposal = await proposeRateEdits(instruction, candidates);
  } catch (e) {
    return NextResponse.json({ error: "ai_failed", detail: String(e) }, { status: 502 });
  }
  if (!proposal) return NextResponse.json({ error: "no_proposal" }, { status: 502 });

  const baseNames = new Set(rateBook.tasks.map((t) => t.name));
  const candNames = new Set(candidates.map((c) => c.name));
  const known = new Map(merged.map((t) => [t.name, t]));

  const edits = proposal.edits
    .map((raw) => {
      const e = raw as unknown as Record<string, unknown>;
      const name = String(e.name ?? "").trim();
      const price = Number(e.final_price);
      if (!name || !isFinite(price) || price < 0) return null;
      const inBook = baseNames.has(name) || candNames.has(name);
      const cur = known.get(name);
      return {
        name,
        category: cur ? String(cur.category ?? "") : String(e.category ?? "Custom"),
        isNew: !inBook,
        final_price: price,
        unit: typeof e.unit === "string" && (UNIT_OPTIONS as readonly string[]).includes(e.unit) ? e.unit : "each",
        labor_minutes: isFinite(Number(e.labor_minutes)) ? Number(e.labor_minutes) : null,
        material_allowance: isFinite(Number(e.material_allowance)) ? Number(e.material_allowance) : null,
        current_price: cur && isPriced(cur.final_price) ? (cur.final_price as number) : null,
        current_unit: cur ? String(cur.unit ?? "each") : null,
        note: String(e.note ?? ""),
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, reply: String(proposal.reply ?? ""), edits });
}
