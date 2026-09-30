// POST /api/jobber/approve. Manny tapped Approve on a proposal from the chat
// box. This is the ONLY place a chat proposed write reaches Jobber. Runs
// safe_update once, reads back, compares, logs before and after, and teaches
// the playbook: a fix for an error the playbook did not know gets a learned
// entry (auto false), and the same fix approved twice flips it to auto.
// Owner only. Draft only, checked again right before the write.
//
// POST with { cancel: true } just logs the cancel.

import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/session";
import { compareReadBack, isSent } from "@/lib/jobberPush/compare";
import { snapshotOf } from "@/lib/jobberPush/expected";
import { recordApproval } from "@/lib/jobberPush/playbook";
import { SendLog, newPushId } from "@/lib/jobberPush/sendLog";
import { playbookStore, prismaSettings, transport } from "@/lib/jobberPush/server";
import type { ExpectedPush, HealProposal } from "@/lib/jobberPush/types";
import { logMemoryEvent } from "@/lib/memory";

export const runtime = "nodejs";

interface Body {
  proposal?: HealProposal;
  estimateId?: string;
  quoteRef?: string;
  expected?: ExpectedPush;
  cancel?: boolean;
  pushId?: string;
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
  const { proposal, estimateId = "", quoteRef = "" } = body;
  if (!proposal || !quoteRef) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const log = new SendLog(body.pushId ?? newPushId(), estimateId, quoteRef);
  if (body.cancel) {
    await log.add("chat_cancel", "CANCELLED", { note: proposal.rationale, before: proposal.before, after: proposal.after });
    return NextResponse.json({ ok: true, cancelled: true });
  }

  const t = transport();
  await log.add("chat_proposal", "APPROVED", { note: proposal.rationale, before: proposal.before, after: proposal.after });

  // Draft guard again, right before the write. The quote may have moved.
  let fresh;
  try {
    fresh = await t.read(quoteRef);
  } catch (err) {
    await log.add("read", "FAILED", { error: (err as Error).message });
    return NextResponse.json({ error: "read_failed", message: (err as Error).message }, { status: 502 });
  }
  if (fresh.quoteStatus !== "draft") {
    await log.add("guard", "BLOCKED_NOT_DRAFT", { note: `quote is ${fresh.quoteStatus}` });
    return NextResponse.json({ error: "not_draft", message: `Quote is ${fresh.quoteStatus}, not a draft. Nothing written.`, readBack: fresh }, { status: 409 });
  }
  const input = { ...proposal.input, quote_id: proposal.input.quote_id || fresh.id };

  const result = await t.safeUpdate(input);
  await log.add("safe_update", result.status, { before: snapshotOf(fresh), after: result.quote ? snapshotOf(result.quote) : undefined, error: result.error, note: "approved from the chat box" });

  let readBack = fresh;
  try {
    readBack = await t.read(quoteRef);
  } catch {
    /* keep the pre write read */
  }
  const compare = body.expected ? compareReadBack(body.expected, readBack) : null;
  await log.add("read_back", readBack.quoteStatus.toUpperCase(), { after: snapshotOf(readBack) });
  if (compare) {
    await log.add("compare", isSent(compare) ? "MATCH" : "NO_MATCH", {
      note: `subtotal ${compare.readSubtotal.toFixed(2)} vs ${compare.expectedSubtotal.toFixed(2)}, text ${compare.textMatch ? "ok" : "differs"}${compare.split ? ", SPLIT STATE" : ""}`,
    });
  }

  // Tax rate Manny just approved goes into the price book.
  if (input.tax_rate_id) {
    await prismaSettings.setTaxRateId(input.tax_rate_id).catch(() => {});
  }

  // Learning. Only a write that actually landed teaches the book.
  let learned: Awaited<ReturnType<typeof recordApproval>> | null = null;
  if (result.status === "OK") {
    try {
      learned = await recordApproval(playbookStore, {
        entryId: proposal.knownEntryId,
        signal: proposal.knownEntryId ? null : proposal.signal,
        fix: proposal.knownEntryId ? (await playbookStore.load()).entries.find((e) => e.id === proposal.knownEntryId)?.fix ?? "replay_approved_update" : "replay_approved_update",
        diagnosis: proposal.rationale || "Fix approved by Manny from the inspector chat box.",
        fixArgs: { with_tax: !!input.tax_rate_id, with_text: input.title !== undefined || input.message !== undefined },
      });
      await log.add("learn", learned.promoted ? "PROMOTED_TO_AUTO" : learned.learned ? "LEARNED" : "APPROVAL_COUNTED", {
        note: `${learned.entry.id} "${learned.entry.match}" -> ${learned.entry.fix}, approvals ${learned.entry.approvals ?? 0}, auto ${learned.entry.auto}`,
      });
    } catch (err) {
      await log.add("learn", "SKIPPED", { note: (err as Error).message });
    }
  }

  const sent = result.status === "OK" && (!compare || isSent(compare));
  await log.add("result", sent ? "SENT" : "STOPPED", { after: snapshotOf(readBack), error: result.error });
  if (sent && estimateId) {
    void logMemoryEvent({ kind: "sent", ref: estimateId, lines: [`Chat approved fix landed on Jobber quote ${readBack.quoteNumber}: subtotal $${readBack.subtotal.toFixed(2)}, tax $${readBack.taxAmount.toFixed(2)}.`] });
  }
  return NextResponse.json({ ok: result.status === "OK", sent, result, readBack, compare, learned, log: log.entries });
}
