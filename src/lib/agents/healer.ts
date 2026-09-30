// The Inspector chat box brain. Headless Claude with exactly two Jobber tools:
// the read action (runs live, read only) and safe_update (NEVER runs from
// here, it only records a proposal). Manny sees the proposal as a before and
// after diff on the push result sheet and nothing writes until he taps
// Approve. Server only. Claude only: this is an owner facing repair tool, the
// local model does not get the Jobber keys.

import type Anthropic from "@anthropic-ai/sdk";
import { makeAnthropic } from "../anthropic";
import { CLAUDE_TEXT_MODEL } from "./client";
import { snapshotOf, snapshotOfExpected } from "../jobberPush/expected";
import type { Playbook } from "../jobberPush/playbook";
import type { ExpectedLine, ExpectedPush, HealProposal, JobberQuoteRead, PushResult, SafeUpdateInput, SendLogEntry } from "../jobberPush/types";
import type { JobberTransport } from "../jobberPush/zapier";

export interface HealerContext {
  quoteRef: string;
  quoteId: string | null;
  expected: ExpectedPush;
  readBack: JobberQuoteRead | null;
  lastPush: PushResult | null;
  sendLog: SendLogEntry[];
  playbook: Playbook;
  inspectorNotes?: string;
  taxRateId: string | null;
}

export interface HealerTurn {
  role: "user" | "assistant";
  content: string;
}

export interface HealerReply {
  reply: string;
  proposal: HealProposal | null;
  toolCalls: { name: string; ok: boolean; note: string }[];
}

const READ_TOOL: Anthropic.Tool = {
  name: "jobber_quote_read",
  description: "Read a Jobber quote (read only). Returns id, quoteNumber, quoteStatus, title, message, clientName, lineItems, subtotal, taxAmount, total. Runs immediately.",
  input_schema: {
    type: "object",
    properties: { quote_ref: { type: "string", description: "Jobber web id, quote number, or encoded GraphQL id." } },
    required: ["quote_ref"],
  },
};

const UPDATE_TOOL: Anthropic.Tool = {
  name: "jobber_quote_safe_update",
  description:
    "PROPOSE a safe update to a draft Jobber quote: replaces all line items (adds new, verifies, deletes old), optionally applies a tax rate and sets title and message. This does NOT run. It records one proposal that Manny must approve on screen. Call it at most once per reply, with the complete final line set.",
  input_schema: {
    type: "object",
    properties: {
      quote_id: { type: "string", description: "Encoded GraphQL quote id from the read." },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            quantity: { type: "number" },
            unit_price: { type: "number" },
            taxable: { type: "boolean" },
          },
          required: ["name", "description", "quantity", "unit_price"],
        },
      },
      title: { type: "string" },
      message: { type: "string" },
      tax_rate_id: { type: "string", description: "Jobber encoded tax rate id, if tax should be applied." },
      expected_subtotal: { type: "number" },
      rationale: { type: "string", description: "One or two plain sentences for Manny on why this fixes it." },
    },
    required: ["quote_id", "line_items", "rationale"],
  },
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export function healerSystem(ctx: HealerContext): string {
  const exp = ctx.expected;
  const rb = ctx.readBack;
  const lines = [
    "You are SawBUCK's Jobber inspector for HoneyDone Property Maintenance. Manny is the owner. A quote push to Jobber stopped and he is asking you about it.",
    "",
    "Rules:",
    "- Plain English, short, direct, no em dashes, no semicolons. Talk like a sharp coworker, not a manual.",
    "- SawBUCK's lines, subtotal, title and message below are the truth. Jobber should end up matching them exactly.",
    "- Only draft quotes can change. If the quote is not a draft, say so and propose nothing.",
    "- You have two Jobber tools. jobber_quote_read runs live. jobber_quote_safe_update only RECORDS a proposal that Manny approves on screen, nothing writes without his Approve. Never claim a write happened.",
    "- When Manny asks how to fix it, read the quote if the read back is stale, then propose ONE safe update with the complete SawBUCK line set (never a partial set: safe_update replaces every line).",
    "- If a materials line is taxable and taxAmount is 0, include tax_rate_id when one is on file. If none is on file, ask Manny for the Jobber tax rate id instead of guessing.",
    "- Never propose a new quote. Update mode never falls back to create.",
    "",
    `Quote ref: ${ctx.quoteRef}. Encoded id: ${ctx.quoteId ?? "(unknown, read the quote first)"}.`,
    `Tax rate id on file: ${ctx.taxRateId ?? "none"}.`,
    "",
    "SAWBUCK EXPECTED:",
    `title: ${exp.title || "(empty)"}`,
    `subtotal: ${money(exp.subtotal)}`,
    ...exp.lines.map((l) => `- ${l.name} | qty ${l.quantity} | ${money(l.unit_price)} | ${l.taxable ? "taxable" : "no tax"} | ${l.description}`),
    "message:",
    exp.message,
    "",
    "LATEST JOBBER READ BACK:",
    rb
      ? [
          `quote ${rb.quoteNumber} (${rb.quoteStatus}) for ${rb.clientName}`,
          `title: ${rb.title || "(empty)"}`,
          `subtotal ${money(rb.subtotal)}, tax ${money(rb.taxAmount)}, total ${money(rb.total)}`,
          ...rb.lineItems.map((l) => `- [${l.id ?? "no id"}] ${l.name} | qty ${l.quantity} | ${money(l.unitPrice)} | ${l.taxable ? "taxable" : "no tax"} | ${l.description}`),
          "message:",
          rb.message,
        ].join("\n")
      : "(no read back yet)",
    "",
    "LAST PUSH:",
    ctx.lastPush
      ? `${ctx.lastPush.status}${ctx.lastPush.stopCode ? " " + ctx.lastPush.stopCode : ""}. ${ctx.lastPush.reason ?? ""} Writes: ${ctx.lastPush.writes}. Heal attempts: ${ctx.lastPush.attempts.map((a) => `${a.fix ?? "?"} (${a.ran ? "ran" : "skipped"}: ${a.note})`).join("; ") || "none"}.`
      : "(none)",
    "",
    "SEND LOG (oldest first):",
    ...ctx.sendLog.slice(-40).map((e) => `${e.ts.slice(11, 19)} ${e.phase} ${e.status}${e.note ? " " + e.note : ""}${e.error ? " ERR " + e.error.slice(0, 200) : ""}`),
    "",
    "PLAYBOOK:",
    ...ctx.playbook.entries.map((e) => `- [${e.id}] "${e.match}" -> ${e.fix} (${e.auto ? "auto" : "needs Manny"}, ${e.hits} hits, ${e.source}). ${e.diagnosis}`),
  ];
  if (ctx.inspectorNotes?.trim()) lines.push("", "INSPECTOR NOTES FROM MANNY:", ctx.inspectorNotes.trim());
  return lines.join("\n");
}

function asExpectedLines(raw: unknown): ExpectedLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      return {
        name: String(o.name ?? "").trim(),
        description: String(o.description ?? "").trim(),
        quantity: Number(o.quantity ?? 1) || 1,
        unit_price: Math.round(Number(o.unit_price ?? o.unitPrice ?? 0) * 100) / 100,
        taxable: !!o.taxable,
      };
    })
    .filter((l) => l.name && l.unit_price >= 0);
}

/**
 * One chat turn. Runs the Claude tool loop, executes reads live, captures a
 * single safe_update proposal, and returns the reply text plus the proposal.
 */
export async function healerChat(
  ctx: HealerContext,
  history: HealerTurn[],
  message: string,
  transport: JobberTransport,
  apiKey: string
): Promise<HealerReply> {
  const client = makeAnthropic(apiKey);
  const system = healerSystem(ctx);
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
    { role: "user", content: message },
  ];
  let proposal: HealProposal | null = null;
  const toolCalls: HealerReply["toolCalls"] = [];
  let latestRead = ctx.readBack;
  let reply = "";

  for (let round = 0; round < 6; round++) {
    const resp = await client.messages.create({
      model: CLAUDE_TEXT_MODEL,
      max_tokens: 2048,
      system,
      tools: [READ_TOOL, UPDATE_TOOL],
      messages,
    });
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) reply = text;
    const uses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length || resp.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const input = (u.input ?? {}) as Record<string, unknown>;
      if (u.name === "jobber_quote_read") {
        try {
          const read = await transport.read(String(input.quote_ref ?? ctx.quoteRef));
          latestRead = read;
          toolCalls.push({ name: u.name, ok: true, note: `read ${read.quoteNumber} (${read.quoteStatus}) subtotal ${money(read.subtotal)}` });
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(read) });
        } catch (err) {
          toolCalls.push({ name: u.name, ok: false, note: (err as Error).message });
          results.push({ type: "tool_result", tool_use_id: u.id, content: `READ FAILED: ${(err as Error).message}`, is_error: true });
        }
        continue;
      }
      if (u.name === "jobber_quote_safe_update") {
        if (proposal) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: "A proposal is already recorded for this reply. Only one per reply. Explain it to Manny instead.", is_error: true });
          continue;
        }
        if (latestRead && latestRead.quoteStatus !== "draft") {
          toolCalls.push({ name: u.name, ok: false, note: `refused: quote is ${latestRead.quoteStatus}` });
          results.push({ type: "tool_result", tool_use_id: u.id, content: `REFUSED: quote is ${latestRead.quoteStatus}, not a draft. Nothing can be written. Tell Manny.`, is_error: true });
          continue;
        }
        const lines = asExpectedLines(input.line_items);
        if (!lines.length) {
          results.push({ type: "tool_result", tool_use_id: u.id, content: "REFUSED: line_items is empty. safe_update needs the complete final line set.", is_error: true });
          continue;
        }
        const su: SafeUpdateInput = {
          quote_id: String(input.quote_id || latestRead?.id || ctx.quoteId || ""),
          line_items: lines,
          ...(typeof input.title === "string" ? { title: input.title } : {}),
          ...(typeof input.message === "string" ? { message: input.message } : {}),
          ...(typeof input.tax_rate_id === "string" && input.tax_rate_id ? { tax_rate_id: input.tax_rate_id } : {}),
        };
        const subtotal = Math.round(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0) * 100) / 100;
        su.expected_subtotal = typeof input.expected_subtotal === "number" ? input.expected_subtotal : subtotal;
        const taxRate = su.tax_rate_id ? estimateTaxRate(latestRead) : null;
        proposal = {
          id: `PROP-${Date.now().toString(36)}`,
          input: su,
          rationale: String(input.rationale ?? "").trim(),
          before: snapshotOf(latestRead),
          after: snapshotOfExpected(
            { title: su.title ?? latestRead?.title ?? "", message: su.message ?? latestRead?.message ?? "", lines },
            { quoteStatus: latestRead?.quoteStatus ?? "draft", taxRate }
          ),
          signal: ctx.lastPush?.attempts.at(-1)?.signal ?? ctx.lastPush?.reason ?? null,
          knownEntryId: ctx.lastPush?.pendingEntry?.id ?? null,
        };
        toolCalls.push({ name: u.name, ok: true, note: `proposal recorded, ${lines.length} line(s), subtotal ${money(subtotal)}` });
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: `PROPOSAL RECORDED (not written). Manny sees a before and after diff with Approve and Cancel. Subtotal would be ${money(subtotal)}${su.tax_rate_id ? ", tax applied" : ""}. Now explain it in two or three short sentences.`,
        });
        continue;
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: `Unknown tool ${u.name}`, is_error: true });
    }
    messages.push({ role: "user", content: results });
  }

  if (!reply) reply = proposal ? "Proposed a safe update. Check the diff and hit Approve if it looks right." : "I could not work out a next step. Tell me more about what you see in Jobber.";
  return { reply, proposal, toolCalls };
}

/** Best guess at the tax rate for the after diff: Florida 7 percent unless the read shows one. */
function estimateTaxRate(read: JobberQuoteRead | null): number {
  if (read && read.taxAmount > 0) {
    const taxable = read.lineItems.filter((l) => l.taxable).reduce((s, l) => s + (l.totalPrice ?? l.unitPrice * l.quantity), 0);
    if (taxable > 0) return Math.round((read.taxAmount / taxable) * 10000) / 10000;
  }
  return 0.07;
}
