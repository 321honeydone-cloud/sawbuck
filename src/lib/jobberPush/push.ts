// Update mode push to Jobber: read, safe_update, read back, compare, and the
// self heal loop. Server only.
//
// Hard rules, enforced here and nowhere else:
//   * Update mode NEVER falls back to create. There is no create call in this file.
//   * Only draft quotes get touched. Anything else stops before any write.
//   * SENT only when the final read back matches SawBUCK's subtotal within a
//     penny AND the title and message match. Otherwise STOPPED, with the whole
//     story attached for the result sheet and the chat box.
//   * Max 2 heal attempts per push, then stop.
//   * Every step lands in the send log with before and after state.

import type { Estimate } from "../types";
import { compareReadBack, isSent } from "./compare";
import { buildExpectedPush, snapshotOf, type ExpectedTextParts } from "./expected";
import { NO_WRITE_FIXES, runFix, type HealContext, type PushSettings } from "./heal";
import { deriveSignals, matchPlaybook, recordHit, type PlaybookStore } from "./playbook";
import { SendLog, newPushId, appendSendLog } from "./sendLog";
import type { CompareResult, HealAttempt, JobberQuoteRead, PlaybookEntry, PushResult, SafeUpdateInput, SafeUpdateResult, SendLogEntry } from "./types";
import type { JobberTransport } from "./zapier";

export const MAX_HEALS = 2;

export interface PushUpdateOpts {
  estimate: Estimate;
  text: ExpectedTextParts;
  quoteRef: string;
  transport: JobberTransport;
  playbook: PlaybookStore;
  settings: PushSettings;
  sink?: (e: SendLogEntry) => Promise<void>;
  pushId?: string;
  maxHeals?: number;
  /**
   * Hand the loop an error from somewhere else instead of running the first
   * safe_update. This is how a "Quote can't be blank" from the old Zapier
   * action (or a forced test error) enters the playbook.
   */
  initialError?: string;
}

export async function pushUpdate(opts: PushUpdateOpts): Promise<PushResult> {
  const pushId = opts.pushId ?? newPushId();
  const log = new SendLog(pushId, opts.estimate.id, opts.quoteRef, opts.sink ?? appendSendLog);
  const maxHeals = opts.maxHeals ?? MAX_HEALS;
  const expected = buildExpectedPush(opts.estimate, opts.text);
  const attempts: HealAttempt[] = [];
  let writes = 0;
  let healsUsed = 0;
  let lastRead: JobberQuoteRead | null = null;
  let lastResult: SafeUpdateResult | null = null;
  let compare: CompareResult | null = null;
  let quoteId: string | null = null;

  const finish = (status: PushResult["status"], stopCode: string | null, reason: string | null, pendingEntry: PlaybookEntry | null = null): Promise<PushResult> =>
    log
      .add("result", status, { note: reason ?? undefined, after: snapshotOf(lastRead), error: stopCode ?? undefined })
      .then(() => ({
        status,
        pushId,
        estimateId: opts.estimate.id,
        quoteRef: opts.quoteRef,
        quoteId,
        reason,
        stopCode,
        expected,
        readBack: lastRead,
        compare,
        lastUpdate: lastResult,
        attempts,
        log: log.entries,
        split: compare?.split ?? false,
        pendingEntry,
        writes,
      }));

  const write = async (input: SafeUpdateInput): Promise<SafeUpdateResult> => {
    writes++;
    const before = snapshotOf(lastRead);
    let result: SafeUpdateResult;
    try {
      result = await opts.transport.safeUpdate(input);
    } catch (err) {
      result = { status: "FAILED_CALL", error: (err as Error).message };
    }
    await log.add("safe_update", result.status, {
      note: result.step !== undefined ? `step ${result.step}` : undefined,
      before,
      after: result.quote ? snapshotOf(result.quote) : undefined,
      error: result.error,
    });
    lastResult = result;
    return result;
  };

  await log.add("start", "UPDATE", {
    note: `${expected.lines.length} line(s), subtotal $${expected.subtotal.toFixed(2)}, title "${expected.title || "(empty)"}"`,
    after: { title: expected.title, lines: expected.lines, subtotal: expected.subtotal },
  });
  if (!expected.lines.length) {
    return finish("STOPPED", "BLOCKED_EMPTY_LINES", "SawBUCK has no live line items to push. Nothing written.");
  }

  // 1. Read first. The encoded id from the read is the only id safe_update accepts.
  try {
    lastRead = await opts.transport.read(opts.quoteRef);
  } catch (err) {
    await log.add("read", "FAILED", { error: (err as Error).message });
    return finish("STOPPED", "READ_FAILED", `Could not read quote ${opts.quoteRef} from Jobber: ${(err as Error).message}`);
  }
  quoteId = lastRead.id;
  await log.add("read", lastRead.quoteStatus.toUpperCase(), { before: snapshotOf(lastRead) });

  // 2. Draft guard. Not a heal attempt, nothing has been written.
  if (lastRead.quoteStatus !== "draft") {
    const pb = await opts.playbook.load();
    const hit = matchPlaybook(pb, ["BLOCKED_NOT_DRAFT"]);
    if (hit) await recordHit(opts.playbook, hit.entry.id);
    await log.add("guard", "BLOCKED_NOT_DRAFT", { note: `quote is ${lastRead.quoteStatus}` });
    compare = compareReadBack(expected, lastRead);
    return finish(
      "STOPPED",
      "BLOCKED_NOT_DRAFT",
      `Quote ${lastRead.quoteNumber || opts.quoteRef} is ${lastRead.quoteStatus}, not a draft. SawBUCK only updates drafts. Nothing was written.`,
      hit?.entry ?? null
    );
  }

  const ctxBase = (): Omit<HealContext, "entry" | "signal"> => ({
    transport: opts.transport,
    settings: opts.settings,
    estimate: opts.estimate,
    expected,
    quoteId: quoteId as string,
    quoteRef: opts.quoteRef,
    lastRead,
    lastResult,
    log,
    attempts,
    write,
  });

  // 3. Pre push signals (empty title). These fixes do not write, so they do
  //    not spend a heal attempt.
  {
    const pb = await opts.playbook.load();
    const pre = deriveSignals({ expectedTitle: expected.title });
    const hit = matchPlaybook(pb, pre);
    if (hit && hit.entry.auto) {
      await recordHit(opts.playbook, hit.entry.id);
      const out = await runFix(hit.entry.fix, { ...ctxBase(), entry: hit.entry, signal: hit.signal });
      attempts.push({ n: 0, signal: hit.signal, entryId: hit.entry.id, match: hit.entry.match, fix: hit.entry.fix, auto: true, ran: true, note: out.note, before: null, after: null });
      await log.add("heal_fix", out.ok ? "OK" : "FAILED", { note: `${hit.entry.fix}: ${out.note}` });
    }
  }

  // 4. First write, or the error someone else already hit.
  if (opts.initialError) {
    lastResult = { status: "FAILED_LEGACY_UPDATE", error: opts.initialError };
    await log.add("safe_update", lastResult.status, { note: "error handed to the heal loop, no safe_update run yet", error: opts.initialError, before: snapshotOf(lastRead) });
  } else {
    await write({
      quote_id: quoteId,
      line_items: expected.lines,
      title: expected.title,
      message: expected.message,
      expected_subtotal: expected.subtotal,
    });
  }

  // 5. Read back, compare, heal, repeat.
  for (;;) {
    try {
      lastRead = await opts.transport.read(opts.quoteRef);
    } catch (err) {
      await log.add("read_back", "FAILED", { error: (err as Error).message });
      return finish("STOPPED", "READ_FAILED", `Could not read the quote back after the push: ${(err as Error).message}`);
    }
    const last = attempts[attempts.length - 1];
    if (last && last.ran && !last.after) last.after = snapshotOf(lastRead);
    compare = compareReadBack(expected, lastRead);
    await log.add("read_back", lastRead.quoteStatus.toUpperCase(), { after: snapshotOf(lastRead) });
    await log.add("compare", isSent(compare) ? "MATCH" : "NO_MATCH", {
      note: `subtotal ${compare.readSubtotal.toFixed(2)} vs ${compare.expectedSubtotal.toFixed(2)} (${compare.subtotalMatch ? "ok" : "off " + compare.delta.toFixed(2)}), title ${compare.titleMatch ? "ok" : "differs"}, message ${compare.messageMatch ? "ok" : "differs"}, tax ${compare.taxMissing ? "MISSING" : "ok"}${compare.split ? ", SPLIT STATE" : ""}`,
    });

    const r = lastResult as SafeUpdateResult;
    const signals = deriveSignals({
      status: r.status,
      error: r.error,
      quoteStatus: lastRead.quoteStatus,
      taxMissing: compare.taxMissing,
      subtotalMatch: compare.subtotalMatch,
    });
    if (r.status === "OK" && compare.subtotalMatch && !compare.textMatch) signals.push("TEXT_MISMATCH after OK");

    if (r.status === "OK" && isSent(compare) && !compare.taxMissing) {
      return finish("SENT", null, null);
    }
    if (isSent(compare) && r.status !== "OK" && !compare.taxMissing) {
      // The quote already holds exactly what SawBUCK wants (a heal converged
      // even though the action reported a failure along the way).
      return finish("SENT", null, null);
    }

    const pb = await opts.playbook.load();
    const hit = matchPlaybook(pb, signals);
    if (!hit) {
      await log.add("heal_skip", "NO_PLAYBOOK_MATCH", { note: signals.join(" | ") });
      return finish("STOPPED", "UNKNOWN_ERROR", `No playbook entry for: ${signals[0] ?? "unknown state"}. Ask the chat box below.`);
    }
    await recordHit(opts.playbook, hit.entry.id);
    await log.add("heal_match", hit.entry.id, { note: `${hit.entry.match} -> ${hit.entry.fix} (${hit.entry.auto ? "auto" : "needs Manny"})` });

    if (!hit.entry.auto) {
      // A diagnostic fix (never writes) still runs so the field name or the
      // quote status lands in the log. Anything that writes waits for Manny.
      let reason = hit.entry.diagnosis;
      let ran = false;
      if (NO_WRITE_FIXES.has(hit.entry.fix)) {
        try {
          const out = await runFix(hit.entry.fix, { ...ctxBase(), entry: hit.entry, signal: hit.signal });
          ran = true;
          if (out.needsManny) reason = out.needsManny;
        } catch (err) {
          reason = `${hit.entry.diagnosis} (${(err as Error).message})`;
        }
      }
      attempts.push({ n: healsUsed, signal: hit.signal, entryId: hit.entry.id, match: hit.entry.match, fix: hit.entry.fix, auto: false, ran, note: reason, before: snapshotOf(lastRead), after: null });
      await log.add("heal_skip", "NEEDS_MANNY", { note: reason });
      return finish("STOPPED", "NEEDS_MANNY", reason, hit.entry);
    }
    if (healsUsed >= maxHeals) {
      await log.add("heal_skip", "HEAL_LIMIT", { note: `${maxHeals} heal attempts used` });
      return finish("STOPPED", "HEAL_LIMIT", `Tried ${maxHeals} repairs and the quote still does not match SawBUCK. Last state: ${signals[0]}.`, hit.entry);
    }

    healsUsed++;
    const attempt: HealAttempt = { n: healsUsed, signal: hit.signal, entryId: hit.entry.id, match: hit.entry.match, fix: hit.entry.fix, auto: true, ran: true, note: "", before: snapshotOf(lastRead), after: null };
    attempts.push(attempt);
    let out;
    try {
      out = await runFix(hit.entry.fix, { ...ctxBase(), entry: hit.entry, signal: hit.signal });
    } catch (err) {
      out = { ok: false, note: `fix threw: ${(err as Error).message}`, wrote: false as const };
    }
    attempt.note = out.note;
    await log.add("heal_fix", out.ok ? "OK" : out.needsManny ? "NEEDS_MANNY" : "FAILED", { note: `${hit.entry.fix}: ${out.note}`, before: attempt.before });
    if (out.needsManny) {
      return finish("STOPPED", "NEEDS_MANNY", out.needsManny, hit.entry);
    }
    if (out.result) lastResult = out.result;
    else if (!out.wrote && r.status !== "OK") {
      // The fix had nothing to do and Jobber already holds the right lines.
      // Loop once more so the read back decides.
      lastResult = { ...r, status: "OK", error: undefined };
    }
  }
}
