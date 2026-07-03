// Sawbuck's long-term memory. Server-only (uses fs).
//
// The shop already learns prices (rate book + overrides), but estimates are
// hard-deleted and their chat cascades with them, so the story of each job was
// lost. This module fixes that. Every meaningful event — an estimate completed,
// sent, invoiced, or deleted, or a price correction — is appended to
// SAWBUCK_MEMORY.md as a raw log entry. Every COMPACT_EVERY events the fast
// model distills the log into a short LESSONS section, and ONLY the lessons are
// injected into the estimator prompt, so the prompt never bloats no matter how
// long the log grows.
//
// The file is plain markdown on purpose: Manny can open it, read what Sawbuck
// believes, and edit the lessons by hand. Hand edits win — compaction is told
// to preserve them.
//
// Default location is the project root. Set SAWBUCK_MEMORY_PATH to move it
// (e.g. onto a persistent volume for the Docker deploy).

import { promises as fs } from "fs";
import path from "path";
import { localText } from "./agents/client";

export const MEMORY_PATH =
  process.env.SAWBUCK_MEMORY_PATH || path.join(process.cwd(), "SAWBUCK_MEMORY.md");

const LESSONS_START = "<!-- lessons:start -->";
const LESSONS_END = "<!-- lessons:end -->";
const LOG_START = "<!-- log:start -->";
const LOG_END = "<!-- log:end -->";
const COUNTER_RE = /<!-- new-events: (\d+) -->/;

/** Distill the log into lessons after this many new events. */
const COMPACT_EVERY = 10;
/** Hard cap on the lessons text injected into the prompt. */
const MAX_LESSONS_CHARS = 4000;
/** Raw log entries kept after a compaction (older ones are already distilled). */
const MAX_LOG_ENTRIES = 120;

const SEED = `# Sawbuck Memory

This file is Sawbuck's long-term brain. The LESSONS section gets injected into
the estimator prompt on every single chat. The JOB LOG below is the raw record:
every estimate that completes, gets sent, gets invoiced, or gets DELETED lands
here first, plus every price correction Manny makes. Every ${COMPACT_EVERY} events the log is
automatically distilled into LESSONS by the fast model.

You can edit LESSONS by hand any time. Sawbuck treats what's written there as
shop truth. Deleting an estimate in the app does NOT remove its entry here.

${LESSONS_START}
## Lessons

- (nothing distilled yet)

${LESSONS_END}

## Job Log

Newest first. Do not remove the marker comments below — Sawbuck uses them to
find where to write.

${LOG_START}
<!-- new-events: 0 -->
${LOG_END}
`;

// All writes go through one in-process queue so concurrent requests can't
// interleave read-modify-write cycles on the file.
let queue: Promise<void> = Promise.resolve();
function enqueue(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(fn).catch((err) => {
    console.warn("[memory] write failed:", (err as Error).message);
  });
  return queue;
}

async function readFileEnsured(): Promise<string> {
  try {
    return await fs.readFile(MEMORY_PATH, "utf8");
  } catch {
    await fs.writeFile(MEMORY_PATH, SEED, "utf8");
    return SEED;
  }
}

function section(text: string, start: string, end: string): { body: string; from: number; to: number } | null {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b <= a) return null;
  const from = a + start.length;
  return { body: text.slice(from, b), from, to: b };
}

/** The current lessons text (without markers/header), or "" when empty. */
export async function getLessons(): Promise<string> {
  const text = await readFileEnsured();
  const s = section(text, LESSONS_START, LESSONS_END);
  if (!s) return "";
  const body = s.body.replace(/^\s*## Lessons\s*/m, "").trim();
  if (!body || body.includes("nothing distilled yet")) return "";
  return body.slice(0, MAX_LESSONS_CHARS);
}

/** Prompt block for the estimator, "" until there are lessons. */
export async function memoryBlock(): Promise<string> {
  const lessons = await getLessons();
  if (!lessons) return "";
  return `\n\nSHOP MEMORY — lessons distilled from every past estimate this shop has run, including deleted ones. Treat these as ground truth about how HoneyDone works and apply them whenever they fit:\n${lessons}`;
}

export interface MemoryEvent {
  /** e.g. "completed" | "sent" | "invoiced" | "deleted" | "correction" */
  kind: string;
  /** e.g. an estimate id like EST-10007 */
  ref?: string;
  title?: string;
  lines: string[];
}

/**
 * Append one event to the log (newest first) and kick off compaction when due.
 * Never throws — memory must never break the request that triggered it.
 */
export function logMemoryEvent(event: MemoryEvent): Promise<void> {
  return enqueue(async () => {
    const text = await readFileEnsured();
    const m = text.match(COUNTER_RE);
    const count = (m ? Number(m[1]) : 0) + 1;

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
    const head = [stamp, event.kind, event.ref, event.title].filter(Boolean).join(" | ");
    const entry = `\n### ${head}\n${event.lines.map((l) => `- ${l}`).join("\n")}\n`;

    let next = text.replace(COUNTER_RE, `<!-- new-events: ${count} -->${entry}`);
    if (next === text) {
      // Counter marker missing (hand-edited file) — reinsert it, keep old entries.
      const s = section(text, LOG_START, LOG_END);
      if (!s) throw new Error("memory file is missing its log markers");
      next = text.slice(0, s.from) + `\n<!-- new-events: ${count} -->${entry}` + s.body + text.slice(s.to);
    }
    await fs.writeFile(MEMORY_PATH, next, "utf8");

    if (count >= COMPACT_EVERY) {
      try {
        await compact();
      } catch (err) {
        // Leave the counter high; we'll retry on the next event.
        console.warn("[memory] compaction failed, will retry:", (err as Error).message);
      }
    }
  });
}

/** Split the log body into "### ..." entries (newest first, as stored). */
function logEntries(text: string): string[] {
  const s = section(text, LOG_START, LOG_END);
  if (!s) return [];
  return s.body
    .split(/\n(?=### )/)
    .map((e) => e.trim())
    .filter((e) => e.startsWith("### "));
}

/**
 * Distill the raw log into the LESSONS section using the fast model, reset the
 * new-event counter, and trim the log tail. Runs inside the write queue.
 */
async function compact(): Promise<void> {
  const text = await readFileEnsured();
  const entries = logEntries(text);
  if (entries.length === 0) return;

  const lessonsSec = section(text, LESSONS_START, LESSONS_END);
  const currentLessons = lessonsSec ? lessonsSec.body.replace(/^\s*## Lessons\s*/m, "").trim() : "";

  // Compaction always runs on the shop's own Ollama box — never the paid API.
  // localText throws if the box is unreachable; the caller leaves the event
  // counter high so we simply retry on the next logged event.
  const raw = await localText({
    system:
      "You maintain the long-term memory of Sawbuck, the AI estimator for HoneyDone Property Maintenance " +
      "(insured handyman in Florida, $100/hr labor, 25% materials markup, $100 trip fee, every job under $2,500). " +
      "You turn raw job-log entries into short, durable lessons the estimator reads before every quote. " +
      "Keep any existing lesson that still looks true — especially hand-written ones — and fold new evidence in.",
    prompt:
      `CURRENT LESSONS:\n${currentLessons || "(none yet)"}\n\n` +
      `JOB LOG (newest first):\n${entries.slice(0, 60).join("\n\n")}\n\n` +
      "Rewrite the lessons list. Focus on: pricing tendencies with real numbers, repeated price corrections " +
      "(what the AI keeps getting wrong and the right number), common job types with typical hours and totals, " +
      "per-user patterns and preferences, and anything about deleted estimates worth remembering. " +
      "Be specific, no filler. Maximum 40 bullets and 3500 characters. " +
      "Output ONLY markdown bullet lines starting with '- ', nothing else.",
    temperature: 0.2,
    // The shop box (qwen3-32b) needs room to chew on a big log.
    timeoutMs: 180000,
  });

  const lessons = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .join("\n")
    .slice(0, MAX_LESSONS_CHARS);
  if (!lessons) throw new Error("model returned no lessons");

  // Re-read: another event may have appended while the model was thinking.
  const fresh = await readFileEnsured();
  const freshEntries = logEntries(fresh).slice(0, MAX_LOG_ENTRIES);
  const ls = section(fresh, LESSONS_START, LESSONS_END);
  const logs = section(fresh, LOG_START, LOG_END);
  if (!ls || !logs) throw new Error("memory file is missing its markers");

  let next =
    fresh.slice(0, ls.from) +
    `\n## Lessons\n\n${lessons}\n\n` +
    fresh.slice(ls.to, logs.from) +
    `\n<!-- new-events: 0 -->\n\n${freshEntries.join("\n\n")}\n` +
    fresh.slice(logs.to);
  next = next.replace(/\n{4,}/g, "\n\n\n");
  await fs.writeFile(MEMORY_PATH, next, "utf8");
  console.log(`[memory] compacted ${freshEntries.length} log entries into ${lessons.split("\n").length} lessons`);
}

// -------------------------------------------------------------------
// Estimate snapshots
// -------------------------------------------------------------------

interface EstimateRowLike {
  id: string;
  name: string;
  status: string;
  finishLevel: string;
  markupDefault: number;
  data: string; // JSON blob { groups, totals }
  userId?: string | null;
}

interface ParsedData {
  groups?: {
    name?: string;
    items?: { name?: string; quantity?: number; unit?: string; unitCost?: number; costType?: string }[];
  }[];
  totals?: { totalCost?: number; totalMarkup?: number; estimateTotal?: number };
}

/**
 * Distill a DB estimate row (plus the user's chat asks) into a memory event.
 * Called right before a hard delete and when an estimate leaves draft, so the
 * job survives even after the row and its chat are gone.
 */
export function snapshotEstimate(kind: string, row: EstimateRowLike, asks: string[]): Promise<void> {
  let parsed: ParsedData = {};
  try {
    parsed = JSON.parse(row.data || "{}") as ParsedData;
  } catch {
    /* keep going with what we have */
  }
  const groups = parsed.groups ?? [];
  const items = groups.flatMap((g) => g.items ?? []);
  const t = parsed.totals ?? {};

  const lines: string[] = [];
  if (asks.length > 0) {
    lines.push("asked: " + asks.map((a) => `"${a.replace(/\s+/g, " ").trim().slice(0, 140)}"`).join("; "));
  }
  lines.push(
    `final: ${groups.length} group(s), ${items.length} line(s), total $${Math.round(t.estimateTotal ?? 0)} ` +
      `(cost $${Math.round(t.totalCost ?? 0)} + markup $${Math.round(t.totalMarkup ?? 0)}), ` +
      `finish ${row.finishLevel}, markup ${row.markupDefault}%`
  );
  const top = items.slice(0, 8).map(
    (it) => `${(it.name ?? "?").slice(0, 60)} — ${it.quantity ?? "?"} ${it.unit ?? ""} @ $${it.unitCost ?? "?"} (${it.costType ?? "?"})`
  );
  if (top.length > 0) lines.push("lines: " + top.join("; "));
  if (items.length > 8) lines.push(`(+${items.length - 8} more lines)`);

  return logMemoryEvent({ kind, ref: row.id, title: row.name, lines });
}
