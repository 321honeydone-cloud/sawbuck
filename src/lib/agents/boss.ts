// The Boss, the one main brain that directs the crew.
//
// Every chat request comes here first. The Boss sends any photos, PDFs, or video
// frames to the Vision employee, works out which trades the job touches and any
// timeframe the customer named, sends the Pricing Research employee to the web
// for any task the rate book cannot price (and answers plain pricing questions),
// then hands off to the Estimator, which builds the quote grouped by trade. When
// an admin is signed in the Boss narrates every hand-off as trace deltas. A short
// crew badge of the agents that handled the turn is shown to everyone. The Boss
// also CHECKS the crew's work: it reviews the Estimator's lines as they stream,
// fills any blank price from the Pricing agent's market numbers, and warns before
// a quote with a missing price goes out. Server-only.

import type { EngineDelta } from "../engine";
import type { Estimate, Attachment } from "../types";
import { chatJson, chatText, cloudBrain } from "./client";
import { describeAttachments } from "./vision";
import { rateBookMatches, runEstimator } from "./estimator";
import { getRateBookEngine } from "../loadRateBook";
import { researchPrices, formatFindingsForPrompt, type PriceFinding } from "./pricing";
import { saveResearchedPrices } from "../pricingStore";
import { isCapGroup } from "../builds";
import { complicationsCapOps } from "../capgen";

export interface BossArgs {
  message: string;
  estimate: Estimate;
  attachments: Attachment[];
  isAdmin: boolean;
  /** learnedRates + priced-book text for the estimator's system prompt. */
  systemExtra?: string;
  /** recent user/ai turns so the crew remembers the conversation. */
  history?: { role: "user" | "ai"; content: string }[];
}

const ASSISTANT_SYSTEM = `You are the assistant inside HoneyDone's estimating app, an insured Florida handyman and property maintenance service (not a licensed contractor). Answer the user's question in 1 to 4 short, friendly sentences. No em dashes and no semicolons. If they want you to build or change an estimate, tell them to describe the job and you will price it.`;

// The crew of trade agents the Boss can dispatch to. Each is matched by the words
// a contractor would actually use. The Estimator does the building, but tagging
// the trade lets the Boss show the branch and lets the quote group cleanly.
const TRADE_KEYWORDS: { trade: string; rx: RegExp }[] = [
  { trade: "Carpentry & Rot", rx: /\b(fascia|soffit|trim|framing|stud|joist|rot|rotten|wood|carpentr|baseboard|crown|jamb|subfloor|beam|rafter)\b/i },
  { trade: "Drywall & Paint", rx: /\b(drywall|sheetrock|patch|texture|paint|primer|mud|tape|skim|wall repair)\b/i },
  { trade: "Tile & Wet Areas", rx: /\b(tile|grout|shower|tub|backsplash|bath(room)?|wet area|caulk|waterproof|pan liner)\b/i },
  { trade: "Plumbing & Fixtures", rx: /\b(toilet|faucet|sink|drain|valve|water heater|plumb|p-?trap|supply line|garbage disposal|hose bib)\b/i },
  { trade: "Electrical", rx: /\b(outlet|gfci|breaker|panel|wiring|light fixture|switch|electric|ceiling fan|recessed)\b/i },
  { trade: "Pressure Washing", rx: /\b(pressure wash|power wash|soft wash|driveway clean|mildew|algae|wash the)\b/i },
  { trade: "Decks & Fences", rx: /\b(deck|fence|railing|gate|fence post|picket|pergola|lattice)\b/i },
  { trade: "Doors & Windows", rx: /\b(window|door|screen|weatherstrip|threshold|sliding glass|storm door)\b/i },
  { trade: "Roofing & Exterior", rx: /\b(roof|shingle|flashing|gutter|downspout|siding|stucco|exterior wall)\b/i },
];

/** Plain pricing questions ("what should this cost", "going rate") go to Pricing Research. */
const PRICING_Q = /\b(what.*\bcost\b|how much (?:would|does|to|is|are)|going rate|market (?:price|rate)|median price|typical (?:price|cost)|average (?:price|cost)|what (?:do|should) (?:i|you|we) charge|price check)\b/i;

/** Which trades does this job text touch? Empty means a general single-trade job. */
function detectTrades(text: string): string[] {
  if (!text.trim()) return [];
  const hits = TRADE_KEYWORDS.filter((t) => t.rx.test(text)).map((t) => t.trade);
  return Array.from(new Set(hits));
}

/** Pull a rough timeframe the customer named, for scheduling notes (not pricing). */
function detectTimeframe(text: string): string {
  const m = text.match(
    /\b(today|tonight|tomorrow|asap|this week|next week|this weekend|by (?:end of day|eod|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|within \d+\s*(?:hours?|days?|weeks?)|in \d+\s*(?:hours?|days?|weeks?))\b/i
  );
  return m ? m[0].toLowerCase() : "";
}

/** Extra system guidance so the Estimator groups by trade and notes any deadline. */
function buildFocus(trades: string[], timeframe: string): string {
  const parts: string[] = [];
  if (trades.length) {
    parts.push(
      `\n\nTRADE FOCUS: This job involves ${trades.join(
        ", "
      )}. Group the line items under these trades with a clear heading per trade, and price each trade's tasks using its usual methods and materials.`
    );
  }
  if (timeframe) {
    parts.push(
      `\n\nTIMEFRAME: The customer wants this done ${timeframe}. You may mention scheduling or urgency in your reply, but do not change the prices because of it.`
    );
  }
  return parts.join("");
}

/** Compact recent-conversation block so the crew remembers what was already said. */
function historyBlock(history?: { role: "user" | "ai"; content: string }[]): string {
  if (!history || history.length === 0) return "";
  const lines = history
    .slice(-8)
    .map((h) => `${h.role === "ai" ? "Assistant" : "User"}: ${(h.content || "").slice(0, 400)}`);
  return `\n\nRECENT CONVERSATION (context only, do not repeat it back):\n${lines.join("\n")}`;
}

type Intent = { intent: "estimate" | "question"; why: string };

/** Quick router call. Defaults to building an estimate, the app's whole point. */
async function classify(message: string, hasItems: boolean): Promise<Intent> {
  try {
    const out = await chatJson<Intent>({
      system: `You route messages inside a contractor's estimating app. Decide if the user wants to build or change a job estimate ("estimate") or is just asking a general question or chatting ("question"). When in doubt choose estimate, that is the app's job. Respond as JSON with keys intent ("estimate" or "question") and why (a few words).`,
      prompt: `The estimate ${hasItems ? "already has line items" : "is empty"}. User said: ${message}`,
      schema: {
        type: "object",
        properties: { intent: { type: "string", enum: ["estimate", "question"] }, why: { type: "string" } },
        required: ["intent", "why"],
      },
      temperature: 0.1,
      timeoutMs: 20000,
    });
    if (out && (out.intent === "estimate" || out.intent === "question")) return out;
  } catch {
    /* fall through to default */
  }
  return { intent: "estimate", why: "default to estimating" };
}

async function* streamWords(text: string): AsyncGenerator<EngineDelta> {
  for (const w of text.split(/(\s+)/)) {
    if (!w) continue;
    yield { type: "text", text: w };
    await new Promise((r) => setTimeout(r, 14));
  }
}

/** Normalize a task name for loose matching against a market finding. */
function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Find a market finding whose task name overlaps this line name, or null. */
function matchFinding(name: string, findings: PriceFinding[]): PriceFinding | null {
  const n = normName(name);
  if (!n) return null;
  for (const f of findings) {
    const t = normName(f.task);
    if (t && (n.includes(t) || t.includes(n))) return f;
  }
  return null;
}

/**
 * The Boss checks the Estimator's work as it streams. It fills any blank or zero
 * price from the Pricing agent's findings, counts duplicates, and at the end
 * warns the user about lines that still have no price. Admins also get a QA
 * summary in the trace. This wraps an Estimator stream and re-yields it.
 */
async function* reviewStream(
  src: AsyncGenerator<EngineDelta>,
  findings: PriceFinding[],
  isAdmin: boolean,
  estimate: Estimate
): AsyncGenerator<EngineDelta> {
  let lineCount = 0;
  let zeroFixed = 0;
  let zeroLeft = 0;
  let dupes = 0;
  const seen = new Set<string>();

  // Guarantee a Complications Cap by the end of the turn. Seed from the estimate
  // as it stands, then watch what the estimator adds this turn.
  let sawCap = estimate.groups.some((g) => isCapGroup(g.name));
  const scopeNames: string[] = estimate.groups.flatMap((g) => g.items).map((i) => i.name);
  let baseTotal = estimate.groups
    .filter((g) => !isCapGroup(g.name))
    .flatMap((g) => g.items)
    .reduce((s, i) => s + (i.clientTotal || 0), 0);

  for await (const d of src) {
    if (d.type === "operation" && d.operation.op === "add_line_item") {
      const op = { ...d.operation };
      lineCount++;
      const key = normName(op.name);
      if (key) {
        if (seen.has(key)) dupes++;
        else seen.add(key);
      }
      if (!(op.unitCost > 0)) {
        const f = matchFinding(op.name, findings);
        if (f && f.median > 0) {
          op.unitCost = f.median;
          zeroFixed++;
          if (isAdmin) yield { type: "trace", text: `Boss QA: filled blank price for ${op.name} at market $${f.median}` };
        } else {
          zeroLeft++;
          if (isAdmin) yield { type: "trace", text: `Boss QA: ${op.name} has no price` };
        }
      }
      if (isCapGroup(op.groupName)) {
        sawCap = true;
      } else {
        scopeNames.push(op.name);
        baseTotal += op.quantity * op.unitCost * (op.costType === "Material" ? 1.25 : 1);
      }
      yield { type: "operation", operation: op };
      continue;
    }
    if (d.type === "operation" && d.operation.op === "add_group" && isCapGroup(d.operation.name)) {
      sawCap = true;
    }
    yield d;
  }

  if (zeroFixed > 0) {
    yield* streamWords(`\n\nI filled ${zeroFixed} blank price${zeroFixed === 1 ? "" : "s"} from current market rates.`);
  }
  if (zeroLeft > 0) {
    yield* streamWords(
      `\n\nHeads up, ${zeroLeft} line${zeroLeft === 1 ? "" : "s"} still need${zeroLeft === 1 ? "s" : ""} a price before you send this. Give me a number or ask me to look it up.`
    );
  }
  if (isAdmin) {
    if (dupes > 0) yield { type: "trace", text: `Boss QA: ${dupes} possible duplicate line${dupes === 1 ? "" : "s"}` };
    yield { type: "trace", text: `Boss QA: reviewed ${lineCount} line${lineCount === 1 ? "" : "s"}, fixed ${zeroFixed}, flagged ${zeroLeft}` };
  }

  // Never let a quote go out without a Max Price Guarantee. If the estimator did
  // not build a Complications Cap this turn (weaker local models skip it), add
  // one automatically, itemized by the risky work in the scope.
  if (!sawCap && baseTotal > 0) {
    for (const op of complicationsCapOps(scopeNames.join(" "), baseTotal)) {
      yield { type: "operation", operation: op };
    }
    if (isAdmin) yield { type: "trace", text: "Boss: auto-added a Complications Cap (estimator left it off)" };
    yield* streamWords(
      "\n\nI added a Complications Cap so this quote carries a Max Price Guarantee. Those lines are only charged if that exact issue turns up, otherwise they drop off."
    );
  }
}

/** Run the whole chat turn through the Boss and its employees. */
export async function* runChat(args: BossArgs): AsyncGenerator<EngineDelta> {
  const trace = (text: string): EngineDelta[] => (args.isAdmin ? [{ type: "trace", text }] : []);
  const hasItems = args.estimate.groups.some((g) => g.items.length > 0);
  const hasAttachments = args.attachments.length > 0;

  yield* trace("Boss: reading the request");

  // Step 1, eyes first. Anything attached goes to the Vision employee.
  let visionText = "";
  if (hasAttachments) {
    yield* trace(`Boss to Vision: ${args.attachments.length} attachment${args.attachments.length === 1 ? "" : "s"}`);
    try {
      const v = await describeAttachments(args.message, args.attachments);
      visionText = v.description;
      yield* trace(`Vision to Boss: ${visionText || "nothing readable"}`);
    } catch (err) {
      yield* trace(`Vision failed: ${(err as Error).message}`);
    }
  }

  const combined = (visionText ? `${args.message} ${visionText}` : args.message).trim();

  // Step 2, work out the trades and any timeframe, then narrate the branch.
  const trades = detectTrades(combined);
  const timeframe = detectTimeframe(args.message);
  if (timeframe) yield* trace(`Boss: timeframe noted, ${timeframe}`);
  if (trades.length) {
    yield* trace(`Boss: trades detected, ${trades.join(", ")}`);
    for (const t of trades) yield* trace(`Boss to ${t} agent: cover the ${t.toLowerCase()} scope`);
  } else {
    yield* trace("Boss to General Service agent: handle the scope");
  }

  // Step 3, Pricing Research. Fill price gaps the rate book cannot cover, or
  // answer a plain pricing question. Cloud-only (needs Claude web search).
  const cloud = (await cloudBrain()).ready;
  const location = args.estimate.location || "Florida";
  const pricingQuestion = PRICING_Q.test(args.message);
  let marketExtra = "";
  let findings: PriceFinding[] = [];
  if (cloud && combined) {
    try {
      let gaps: string[] = [];
      if (pricingQuestion) {
        gaps = [args.message.trim()];
        yield* trace("Boss to Pricing Research agent: pricing question, searching the web");
      } else {
        let unmatched: string[] = [];
        try {
          unmatched = getRateBookEngine()
            .match(combined)
            .unmatched.map((u) => u.text)
            .filter(Boolean);
        } catch {
          unmatched = [];
        }
        gaps = unmatched.slice(0, 6);
        if (gaps.length)
          yield* trace(
            `Boss to Pricing Research agent: ${gaps.length} task${gaps.length === 1 ? "" : "s"} not in the book, searching the web`
          );
      }
      if (gaps.length) {
        findings = await researchPrices(gaps, location, pricingQuestion ? 3 : 6);
        for (const f of findings) yield* trace(`Pricing to Boss: ${f.task}, median $${f.median} per ${f.unit}`);
        if (findings.length) {
          marketExtra = formatFindingsForPrompt(findings);
          if (args.isAdmin) {
            const saved = await saveResearchedPrices(findings);
            if (saved) yield* trace(`Pricing: saved ${saved} price${saved === 1 ? "" : "s"} into the rate book`);
          }
        }
      }
    } catch (err) {
      yield* trace(`Pricing Research failed: ${(err as Error).message}`);
    }
  }

  // Crew badge, shown to everyone.
  const crew = trades.length ? [...trades] : pricingQuestion ? [] : ["General Service"];
  if (findings.length) crew.push("Pricing Research");
  if (crew.length) yield { type: "agents", agents: crew };

  // On-demand pricing question: answer with the market numbers and stop.
  if (pricingQuestion && findings.length) {
    const f = findings[0];
    yield* streamWords(
      `Market rate for ${f.task} in ${location} runs about $${f.median} per ${f.unit}, usually $${f.low} to $${f.high}. ${f.basis}`.trim()
    );
    if (findings.length > 1) {
      yield* streamWords(
        "\n\nAlso found " + findings.slice(1).map((x) => `${x.task} around $${x.median} per ${x.unit}`).join(", ") + "."
      );
    }
    return;
  }

  const systemExtra = (args.systemExtra ?? "") + buildFocus(trades, timeframe) + marketExtra + historyBlock(args.history);

  // Step 4, route. Fast lanes skip the classifier. When we researched gap prices,
  // take the model path so those numbers actually make it into the quote.
  if (hasAttachments) {
    yield* trace("Boss to Estimator: price what Vision saw");
    yield* reviewStream(runEstimator({ message: args.message, estimate: args.estimate, visionText, systemExtra }), findings, args.isAdmin, args.estimate);
    return;
  }
  if (!hasItems && !findings.length && rateBookMatches(combined)) {
    yield* trace("Boss to Estimator: rate-book match, flat pricing");
    yield* reviewStream(runEstimator({ message: args.message, estimate: args.estimate, systemExtra }), findings, args.isAdmin, args.estimate);
    return;
  }

  // The classifier is a blocking, non-streaming LLM call. On a big local model
  // that first cold round trip is what makes the app "hang" before any text
  // appears, and it only ever defaults to "estimate" anyway. So we only spend it
  // on the fast cloud brain; on Local we go straight to estimating (the app's
  // whole job) and let the estimator start streaming immediately.
  const decision: Intent = cloud
    ? await classify(args.message, hasItems)
    : { intent: "estimate", why: "local brain, building without the classifier" };
  if (decision.intent === "question") {
    yield* trace(`Boss: answering directly, ${decision.why}`);
    try {
      const answer = await chatText({ system: ASSISTANT_SYSTEM + historyBlock(args.history), prompt: args.message, temperature: 0.5 });
      yield* streamWords(answer || "Tell me about the job and I will price it.");
    } catch (err) {
      yield* streamWords(`I could not reach the brain right now. ${(err as Error).message}. Give it a second and try again.`);
    }
    return;
  }

  yield* trace(`Boss to Estimator: ${hasItems ? "edit the quote" : "build the quote"}, ${decision.why}`);
  yield* reviewStream(runEstimator({ message: args.message, estimate: args.estimate, systemExtra }), findings, args.isAdmin, args.estimate);
}
