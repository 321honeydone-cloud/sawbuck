// Estimate AI engine, the interface the UI talks to.
//
// The UI consumes a stream of deltas from `estimateEngine.send(...)`. When the
// app server is reachable the local Boss runs behind /api/chat on Manny's own
// Ollama; otherwise this deterministic mock keeps the app fully usable, built
// from the same HoneyDone job templates the price book uses.

import type { Attachment, Estimate, Operation, Unit } from "./types";
import { JOB_TEMPLATES, HONEYDONE } from "./honeydone";
import { getRateBookEngine } from "./loadRateBook";

/** Turn a job description into a short, title-cased estimate name. */
export function deriveJobName(text: string): string {
  const first = (text || "").split(/[,\n;]/)[0].trim();
  const words = first.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const titled = words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 48).trim();
  return titled || "Untitled Estimate";
}

/** One streamed event from the engine. */
export type EngineDelta =
  | { type: "text"; text: string } // a chunk of assistant prose (token-ish)
  | { type: "trace"; text: string } // boss/employee routing note (admin only)
  | { type: "operation"; operation: Operation } // a structured mutation to apply
  | { type: "summary"; name: string } // emit a post-generation summary card
  | { type: "milestone"; text: string } // celebration banner
  | { type: "suggestions"; suggestions: string[] } // next-action chips
  | { type: "agents"; agents: string[] } // trade crews handling this job (shown to everyone)
  | { type: "name"; name: string } // auto-derived estimate name
  | { type: "heartbeat" } // keep-alive tick while the model thinks (UI ignores it)
  | { type: "error"; text: string }; // turn-ending failure; the chat shows the text plus a Retry chip

export interface EngineContext {
  estimate: Estimate; // current state, so the engine can edit existing items
  attachments?: Attachment[]; // photos / PDFs the user attached to this message
  history?: { role: "user" | "ai"; content: string }[]; // recent turns, for memory
}

export interface EstimateEngine {
  send(userMessage: string, ctx: EngineContext): AsyncGenerator<EngineDelta>;
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stream a sentence as word-sized text deltas to mimic token streaming. */
async function* streamText(text: string): AsyncGenerator<EngineDelta> {
  const words = text.split(/(\s+)/); // keep whitespace tokens
  for (const w of words) {
    if (!w) continue;
    yield { type: "text", text: w };
    await sleep(18 + (w.length % 4) * 8);
  }
}

/** Build out a HoneyDone job template: groups + line items at real pricing. */
async function* buildTemplate(
  intro: string,
  groups: { name: string; items: Operation[] }[],
  ctx: EngineContext
): AsyncGenerator<EngineDelta> {
  yield* streamText(intro);
  await sleep(250);
  let count = 0;
  for (const g of groups) {
    yield { type: "operation", operation: { op: "add_group", name: g.name } };
    await sleep(120);
    for (const item of g.items) {
      yield { type: "operation", operation: item };
      count += 1;
      await sleep(90);
    }
  }
  await sleep(150);
  yield* streamText(
    `\n\nDone. ${count} line items across ${groups.length} ${groups.length === 1 ? "section" : "sections"}, priced at HoneyDone rates. Review it on the right and tell me what to adjust.`
  );
  yield { type: "summary", name: ctx.estimate.name };
  yield { type: "milestone", text: "Estimate built 🐝" };
  yield {
    type: "suggestions",
    suggestions: ["Add a permit allowance", "Bump material margin to 30%", "Add cleanup & haul-off", "Finalize estimate"],
  };
}

interface Scenario {
  match: (msg: string) => boolean;
  templateKey: string;
}

// Map a few intent patterns onto HoneyDone job templates.
const scenarios: Scenario[] = [
  { match: (m) => /fascia|rot|soffit|drip edge/i.test(m), templateKey: "fascia-rot" },
  { match: (m) => /grout|caulk|tile|tub|shower|bath/i.test(m), templateKey: "regrout-bath" },
  { match: (m) => /drywall|patch|hole|paint|wall/i.test(m), templateKey: "drywall-paint" },
  { match: (m) => /pressure wash|power wash|driveway|paver|seal/i.test(m), templateKey: "pressure-wash" },
];

/** Follow-up handlers that edit an existing estimate rather than build one. */
async function* followUp(msg: string, _ctx: EngineContext): AsyncGenerator<EngineDelta> {
  const m = msg.toLowerCase();

  const markup = m.match(/(\d{1,2})\s*%/);
  if (/margin|markup/.test(m) && markup) {
    const pct = Number(markup[1]);
    yield* streamText(`Setting material margin to ${pct}% on every material line.`);
    await sleep(150);
    yield { type: "operation", operation: { op: "set_markup", target: "all", pct } };
    yield { type: "suggestions", suggestions: ["Finalize estimate", "Add cleanup & haul-off"] };
    return;
  }

  const labor = m.match(/\$?\s*(\d{2,3})\s*\/?\s*hr|labor.*?\$?\s*(\d{2,3})/);
  if (/labor|rate|\/hr/.test(m) && labor) {
    const rate = Number(labor[1] ?? labor[2]);
    yield* streamText(`Setting the labor rate to $${rate}/hr on all labor.`);
    await sleep(150);
    yield { type: "operation", operation: { op: "set_labor_rate", rate } };
    return;
  }

  if (/permit/.test(m)) {
    yield* streamText("Adding a permit allowance.");
    await sleep(150);
    yield { type: "operation", operation: { op: "add_group", name: "Permits" } };
    yield {
      type: "operation",
      operation: { op: "add_line_item", groupName: "Permits", name: "Permit allowance", quantity: 1, unit: "LS", unitCost: 250, costType: "Other" },
    };
    return;
  }

  if (/cleanup|clean-up|haul/.test(m)) {
    yield* streamText("Adding cleanup and haul-off.");
    await sleep(150);
    yield { type: "operation", operation: { op: "add_group", name: "Cleanup" } };
    yield {
      type: "operation",
      operation: { op: "add_line_item", groupName: "Cleanup", name: "Job cleanup & debris haul-off", quantity: 3, unit: "HRS", unitCost: HONEYDONE.laborRate, costType: "Labor" },
    };
    yield {
      type: "operation",
      operation: { op: "add_line_item", groupName: "Cleanup", name: "Dumpster / disposal", quantity: 1, unit: "LS", unitCost: 450, costType: "Other" },
    };
    return;
  }

  if (/finalize|finish|complete|done|lock/.test(m)) {
    yield* streamText("Finalizing the estimate and marking it ready to send.");
    await sleep(150);
    yield { type: "operation", operation: { op: "finalize" } };
    yield { type: "milestone", text: "Estimate finalized ✅" };
    yield { type: "suggestions", suggestions: ["Generate Jobber quote", "Start a new estimate"] };
    return;
  }

  // Generic catch-all so the demo never dead-ends.
  yield* streamText(
    'I can build a full estimate from a job description (try "fascia and rot repair" or "regrout a shower"), or adjust this one. Try "set material margin to 30%" or "add cleanup & haul-off".'
  );
}

export const mockEngine: EstimateEngine = {
  async *send(userMessage, ctx) {
    if (ctx.attachments && ctx.attachments.length > 0) {
      yield* streamText(
        `I see ${ctx.attachments.length} attached ${ctx.attachments.length === 1 ? "file" : "files"}, but offline mode cannot analyze photos or PDFs. Start your local model to turn that on. I will work from your text instead.\n\n`
      );
    }
    const hasItems = ctx.estimate.groups.some((g) => g.items.length > 0);
    const scenario = scenarios.find((s) => s.match(userMessage));
    // Build a fresh estimate when one is requested and nothing substantial exists yet.
    if (scenario && !hasItems) {
      const tpl = JOB_TEMPLATES.find((t) => t.key === scenario.templateKey)!;
      yield* buildTemplate(tpl.intro, tpl.groups, ctx);
      return;
    }
    yield* followUp(userMessage, ctx);
  },
};

// ---------------------------------------------------------------------------
// Boss-backed implementation (streams from /api/chat). The server-side Boss
// directs the Vision and Estimator employees on Manny's local model. If the app
// server itself cannot be reached we fall back to a deterministic client build
// so the estimator still works offline.
// ---------------------------------------------------------------------------

// If the server goes silent for this long the stream is dead, not thinking:
// the boss route heartbeats every 10s even while the model is still working,
// so 45s of true silence means the connection or the server is gone. This
// watchdog is what turns a would-be infinite hang into a visible error.
const STALL_MS = 45000;

async function* streamFromBoss(userMessage: string, ctx: EngineContext): AsyncGenerator<EngineDelta> {
  const ac = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ac.abort(new DOMException("The estimator stopped responding.", "TimeoutError")), STALL_MS);
  };

  try {
    armStall(); // covers the initial connect too
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: userMessage, estimate: ctx.estimate, attachments: ctx.attachments ?? [], history: ctx.history ?? [] }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`boss ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armStall(); // any byte (heartbeats included) proves the server is alive
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as EngineDelta;
      }
    }
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as EngineDelta;
  } finally {
    clearTimeout(stall);
  }
}

// ---------------------------------------------------------------------------
// Rate-book build (offline fallback), the bot's way. Matches a plain-English
// job to rate-book tasks and lays them in at their flat final_price, grouped by
// category. Used only when the app server cannot be reached, since the online
// Boss runs this same logic server-side.
// ---------------------------------------------------------------------------

const UNIT_MAP: Record<string, Unit> = {
  each: "EA", ea: "EA", "per visit": "LS", visit: "LS", hour: "HRS", hr: "HRS",
  hours: "HRS", day: "DAY", "linear foot": "LF", "linear ft": "LF", lf: "LF",
  "square foot": "SF", "square feet": "SF", "sq ft": "SF", sf: "SF", sqft: "SF",
  "square yard": "SY", sy: "SY", "cubic yard": "CY", cy: "CY",
  "lump sum": "LS", ls: "LS", job: "LS",
  "per sq ft": "SF", "per square foot": "SF", "per linear foot": "LF",
  "per hour": "HRS", "per day": "DAY",
  "per sq yard": "SY", "per cubic yard": "CY",
};
const mapUnit = (u?: string): Unit => (u ? UNIT_MAP[u.toLowerCase().trim()] ?? "EA" : "EA");

async function* rateBookBuild(userMessage: string, ctx: EngineContext): AsyncGenerator<EngineDelta> {
  const q = getRateBookEngine().quote(userMessage);

  yield* streamText(
    `Matched ${q.lines.length} ${q.lines.length === 1 ? "task" : "tasks"} in your rate book. Pricing at your flat rates.`
  );
  yield { type: "name", name: deriveJobName(userMessage) };
  await sleep(200);

  const seenGroups = new Set<string>();
  let tripMatched = false;
  for (const line of q.lines) {
    const group = line.category || "Service";
    if (!seenGroups.has(group)) {
      seenGroups.add(group);
      yield { type: "operation", operation: { op: "add_group", name: group } };
      await sleep(70);
    }
    if (/trip fee/i.test(line.task)) tripMatched = true;
    yield {
      type: "operation",
      operation: {
        op: "add_line_item",
        groupName: group,
        name: line.task,
        quantity: line.qty,
        unit: mapUnit(line.unit),
        unitCost: line.unitPrice,
        costType: "Other",
      },
    };
    await sleep(80);
  }

  if (!tripMatched && q.lines.length > 0) {
    yield { type: "operation", operation: { op: "add_group", name: "Service" } };
    yield {
      type: "operation",
      operation: { op: "add_line_item", groupName: "Service", name: "Trip charge", quantity: 1, unit: "LS", unitCost: q.trip, costType: "Other" },
    };
  }

  await sleep(150);
  let closing = `\n\nDone. Flat-rate total $${q.cash} cash, $${q.card} card. The Rate Book panel up top has the same number.`;
  if (q.unmatched.length > 0) {
    closing += ` I could not match: ${q.unmatched.map((u) => u.text).join(", ")}. Add those by hand or reword them.`;
  }
  yield* streamText(closing);
  yield { type: "summary", name: ctx.estimate.name };
  yield { type: "milestone", text: "Priced from your rate book" };
  yield {
    type: "suggestions",
    suggestions: ["Add a Complications Cap", "Add cleanup & haul-off", "Generate Jobber quote", "Finalize estimate"],
  };
}

// The single engine the app imports. The Boss directs everything server-side
// when reachable. If the server is down, a fresh rate-book match is priced
// locally, and anything else falls to the deterministic mock so the app never
// dead-ends.
export const estimateEngine: EstimateEngine = {
  async *send(userMessage, ctx) {
    // Once the server has answered with anything at all (the boss route sends a
    // heartbeat immediately), a later failure means the connection dropped
    // MID-TURN. Falling back to the offline mock at that point used to graft
    // template junk onto a half-built real quote — so instead we say what
    // happened and stop. The offline fallback below is only for a server that
    // never answered in the first place.
    let reached = false;
    try {
      for await (const d of streamFromBoss(userMessage, ctx)) {
        reached = true;
        yield d;
      }
      return;
    } catch (err) {
      if (reached) {
        const msg = err instanceof Error ? err.message : "connection lost";
        yield {
          type: "error",
          text: `\n\nLost the estimator mid-reply: ${msg} Everything above is saved.`,
        };
        return;
      }
      // App server unreachable, build locally so the estimator still works.
    }
    const hasItems = ctx.estimate.groups.some((g) => g.items.length > 0);
    const text = userMessage.trim();
    if (text && !hasItems && getRateBookEngine().match(text).lines.length > 0) {
      yield* rateBookBuild(text, ctx);
      return;
    }
    yield* mockEngine.send(userMessage, ctx);
  },
};
