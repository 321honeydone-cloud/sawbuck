"use client";

// The push result sheet. Lives at the bottom of the Finalize Quote modal for
// the owner. Push an UPDATE to an existing draft Jobber quote, see SENT or
// "The push stopped" with the before and after, the heal attempts, the send
// log, a Split state badge whenever the quote's words and numbers disagree,
// inspector notes, and under them the chat box. The chat proposes fixes as a
// diff with Approve and Cancel. Nothing writes to Jobber without Approve.

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import type { Estimate } from "@/lib/types";
import type { JobberQuote } from "@/lib/jobber";
import type { CompareResult, HealProposal, JobberQuoteRead, PushResult, QuoteSnapshot, SendLogEntry } from "@/lib/jobberPush/types";

type ChatMsg = { id: string; role: "user" | "assistant"; content: string; proposal?: HealProposal | null; tools?: { name: string; ok: boolean; note: string }[] };

interface ApproveReply {
  ok: boolean;
  sent: boolean;
  result: { status: string; error?: string };
  readBack: JobberQuoteRead;
  compare: CompareResult | null;
  learned: { entry: { id: string; match: string; auto: boolean; approvals?: number }; promoted: boolean; learned: boolean } | null;
  log: SendLogEntry[];
  error?: string;
  message?: string;
}

export default function PushResultSheet({
  estimate,
  quote,
  exclusionTexts,
}: {
  estimate: Estimate;
  quote: JobberQuote | null;
  exclusionTexts: string[];
}) {
  const [admin, setAdmin] = useState(false);
  const [quoteRef, setQuoteRef] = useState("");
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [readBack, setReadBack] = useState<JobberQuoteRead | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [log, setLog] = useState<SendLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [simulate, setSimulate] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [notes, setNotes] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAdmin(d?.role === "admin"))
      .catch(() => setAdmin(false));
  }, []);

  useEffect(() => {
    if (!admin) return;
    fetch(`/api/jobber/push?estimateId=${encodeURIComponent(estimate.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { quoteRef?: string | null; log?: SendLogEntry[] } | null) => {
        if (d?.quoteRef && !quoteRef) setQuoteRef(d.quoteRef);
        if (d?.log?.length) setLog(d.log);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, estimate.id]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [chat.length, sending]);

  if (!admin) return null;

  const stopped = result?.status === "STOPPED";
  const split = compare?.split ?? result?.split ?? false;

  const push = async () => {
    if (!quoteRef.trim() || pushing) return;
    setPushing(true);
    setError(null);
    setBanner(null);
    try {
      const res = await fetch("/api/jobber/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          estimate,
          quoteRef: quoteRef.trim(),
          quote: quote ? { quoteTitle: quote.quoteTitle, scopeOfWork: quote.scopeOfWork } : undefined,
          exclusions: exclusionTexts,
          simulateError: simulate.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { result?: PushResult; error?: string; message?: string };
      if (!res.ok || !data.result) throw new Error(data.message || data.error || "Push failed.");
      setResult(data.result);
      setReadBack(data.result.readBack);
      setCompare(data.result.compare);
      setLog((prev) => [...prev, ...data.result!.log]);
      setSimulate("");
      if (data.result.status === "STOPPED") {
        setChat((c) => [
          ...c,
          {
            id: `sys-${Date.now()}`,
            role: "assistant",
            content: `The push stopped: ${data.result!.reason ?? data.result!.stopCode ?? "unknown"}${data.result!.pendingEntry ? ` Playbook: "${data.result!.pendingEntry.match}" -> ${data.result!.pendingEntry.fix}.` : ""} Ask me what to do, or tell me what you see in Jobber.`,
          },
        ]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPushing(false);
    }
  };

  const send = async () => {
    const message = chatInput.trim();
    if (!message || sending) return;
    setChatInput("");
    setSending(true);
    const history = chat.filter((m) => !m.id.startsWith("sys-")).map((m) => ({ role: m.role, content: m.content }));
    setChat((c) => [...c, { id: `u-${Date.now()}`, role: "user", content: message }]);
    try {
      const res = await fetch("/api/jobber/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          estimate,
          quoteRef: quoteRef.trim(),
          quote: quote ? { quoteTitle: quote.quoteTitle, scopeOfWork: quote.scopeOfWork } : undefined,
          exclusions: exclusionTexts,
          lastPush: result,
          readBack,
          inspectorNotes: notes,
        }),
      });
      const data = (await res.json()) as { reply?: string; proposal?: HealProposal | null; toolCalls?: ChatMsg["tools"]; error?: string; message?: string };
      if (!res.ok) throw new Error(data.message || data.error || "Chat failed.");
      setChat((c) => [...c, { id: `a-${Date.now()}`, role: "assistant", content: data.reply ?? "", proposal: data.proposal ?? null, tools: data.toolCalls }]);
    } catch (e) {
      setChat((c) => [...c, { id: `a-${Date.now()}`, role: "assistant", content: `Could not reach the inspector: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  };

  const decide = async (msgId: string, proposal: HealProposal, approve: boolean) => {
    if (approving) return;
    setApproving(proposal.id);
    try {
      const res = await fetch("/api/jobber/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposal,
          estimateId: estimate.id,
          quoteRef: quoteRef.trim(),
          expected: result?.expected,
          cancel: !approve,
          pushId: result?.pushId,
        }),
      });
      const data = (await res.json()) as ApproveReply & { cancelled?: boolean };
      // Mark the proposal decided so the buttons go away.
      setChat((c) => c.map((m) => (m.id === msgId ? { ...m, proposal: m.proposal ? { ...m.proposal, id: `${m.proposal.id}:${approve ? "approved" : "cancelled"}` } : m.proposal } : m)));
      if (!approve) {
        setBanner("Cancelled. Nothing was written to Jobber.");
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Approve failed.");
      setReadBack(data.readBack);
      setCompare(data.compare);
      setLog((prev) => [...prev, ...(data.log ?? [])]);
      const learnNote = data.learned
        ? data.learned.promoted
          ? ` Playbook: "${data.learned.entry.match}" now runs on its own.`
          : data.learned.learned
            ? ` Playbook learned "${data.learned.entry.match}" (needs one more approval before it goes auto).`
            : ` Playbook approval ${data.learned.entry.approvals ?? 1} counted for "${data.learned.entry.match}".`
        : "";
      setBanner(
        data.sent
          ? `Approved and written. Jobber now matches SawBUCK: subtotal ${money(data.readBack.subtotal)}, tax ${money(data.readBack.taxAmount)}.${learnNote}`
          : `Written (${data.result.status}${data.result.error ? ": " + data.result.error : ""}) but the read back still does not match SawBUCK.${learnNote}`
      );
      if (result) setResult({ ...result, status: data.sent ? "SENT" : "STOPPED", readBack: data.readBack, compare: data.compare, split: data.compare?.split ?? false, reason: data.sent ? null : result.reason });
    } catch (e) {
      setBanner(`Approve failed: ${(e as Error).message}`);
    } finally {
      setApproving(null);
    }
  };

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Label>Push update to Jobber</Label>
          <p className="mt-0.5 text-xs text-muted">Update mode only. Draft quotes only. Reads first, adds new lines before deleting old ones, then checks the quote back against this sheet.</p>
        </div>
        {split && <SplitBadge reason={compare?.splitReason ?? null} />}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={quoteRef}
          onChange={(e) => setQuoteRef(e.target.value)}
          placeholder="Jobber quote # or web id (e.g. 20260089 or 66460097)"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card-2 px-2.5 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
        />
        <button
          onClick={push}
          disabled={!quoteRef.trim() || pushing || !estimate.groups.some((g) => g.items.some((i) => !i.off))}
          className="shrink-0 rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
        >
          {pushing ? "Pushing…" : "Push update"}
        </button>
      </div>
      <details className="mt-1.5">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Test the playbook</summary>
        <div className="mt-1 flex gap-2">
          <input
            value={simulate}
            onChange={(e) => setSimulate(e.target.value)}
            placeholder={`Fake error text, e.g. Quote can't be blank`}
            className="min-w-0 flex-1 rounded-lg border border-border bg-card-2 px-2.5 py-1 text-xs text-ink outline-none placeholder:text-muted focus:border-brand/60"
          />
          <button onClick={() => setSimulate("Quote can't be blank. Please include at least one line item.")} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-ink">
            Use blank error
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted">The fake error is handed to the heal loop in place of the first write. The playbook should route it to safe_update.</p>
      </details>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {result && (
        <div className={`mt-3 rounded-lg border p-3 ${stopped ? "border-danger/50 bg-danger/10" : "border-gain/40 bg-gain/10"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className={`font-display text-base font-semibold uppercase tracking-[0.06em] ${stopped ? "text-danger" : "text-gain"}`}>
                {stopped ? "The push stopped" : "Sent"}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {result.pushId} · quote {result.readBack?.quoteNumber ?? result.quoteRef} · {result.writes} write{result.writes === 1 ? "" : "s"} · {result.attempts.filter((a) => a.ran).length} self heal
                {result.attempts.filter((a) => a.ran).length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {result.stopCode && <Tag>{result.stopCode}</Tag>}
              {split && <SplitBadge reason={compare?.splitReason ?? null} />}
            </div>
          </div>
          {result.reason && <p className="mt-2 text-sm text-ink">{result.reason}</p>}
          {result.pendingEntry && (
            <p className="mt-1 text-xs text-muted">
              Playbook: &quot;{result.pendingEntry.match}&quot; → {result.pendingEntry.fix} ({result.pendingEntry.auto ? "auto" : "needs you"}, {result.pendingEntry.hits} hit
              {result.pendingEntry.hits === 1 ? "" : "s"})
            </p>
          )}

          <div className="mt-3">
            <Label>SawBUCK vs Jobber read back</Label>
            <SnapshotDiff before={snapshotFromRead(readBack)} after={expectedSnapshot(result)} beforeLabel="Jobber now" afterLabel="SawBUCK expects" compare={compare} />
          </div>

          {result.attempts.length > 0 && (
            <div className="mt-3">
              <Label>Heal attempts</Label>
              <ul className="mt-1 space-y-1">
                {result.attempts.map((a, i) => (
                  <li key={i} className="text-xs text-ink">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gold">{a.n === 0 ? "pre" : `#${a.n}`}</span> {a.match ?? a.signal} → <span className="font-mono">{a.fix}</span>{" "}
                    <span className={a.ran ? "text-gain" : "text-flag"}>{a.ran ? "ran" : a.auto ? "skipped" : "needs you"}</span>
                    {a.note && <span className="text-muted">. {a.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {log.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowLog((s) => !s)} className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:text-ink">
            {showLog ? "Hide" : "Show"} send log ({log.length})
          </button>
          {showLog && (
            <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-bg p-2 font-mono text-[10px] leading-relaxed text-muted">
              {log
                .slice(-80)
                .map((e) => `${e.ts.slice(11, 19)} ${e.pushId} ${e.phase.padEnd(13)} ${e.status}${e.note ? "  " + e.note : ""}${e.error ? "  ERR " + e.error : ""}`)
                .join("\n")}
            </pre>
          )}
        </div>
      )}

      <div className="mt-4">
        <Label>Inspector notes</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="What you saw in Jobber, what the client wants, anything the inspector should know."
          className="mt-1 w-full resize-y rounded-lg border border-border bg-card-2 px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
        />
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card-2/60">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <Label>Inspector chat</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Reads live · writes only with Approve</span>
        </div>
        <div className="max-h-80 space-y-3 overflow-auto px-3 py-3">
          {chat.length === 0 && (
            <p className="text-xs text-muted">
              Ask about a failed push. Try &quot;why did it stop&quot; or &quot;fix the lines to match the sheet&quot;. Any Jobber write comes back as a diff you approve first.
            </p>
          )}
          {chat.map((m) => (
            <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
              <div className={`inline-block max-w-[92%] rounded-lg px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-brand/15 text-ink" : "bg-card text-ink"}`}>
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                {m.tools && m.tools.length > 0 && (
                  <p className="mt-1 font-mono text-[10px] text-muted">{m.tools.map((t) => `${t.name}: ${t.note}`).join(" · ")}</p>
                )}
              </div>
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  busy={approving === m.proposal.id}
                  onApprove={() => decide(m.id, m.proposal!, true)}
                  onCancel={() => decide(m.id, m.proposal!, false)}
                />
              )}
            </div>
          ))}
          {sending && <p className="text-xs text-muted">Inspector is looking…</p>}
          {banner && <p className="rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-ink">{banner}</p>}
          <div ref={chatEnd} />
        </div>
        <div className="flex gap-2 border-t border-border p-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={!quoteRef.trim()}
            placeholder={quoteRef.trim() ? "Ask about this push…" : "Enter the Jobber quote ref first"}
            className="min-w-0 flex-1 rounded-lg border border-border bg-card-2 px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!chatInput.trim() || sending || !quoteRef.trim()}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-ink transition hover:border-brand/60 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ProposalCard({ proposal, busy, onApprove, onCancel }: { proposal: HealProposal; busy: boolean; onApprove: () => void; onCancel: () => void }) {
  const decided = proposal.id.includes(":approved") ? "approved" : proposal.id.includes(":cancelled") ? "cancelled" : null;
  return (
    <div className="mt-2 rounded-lg border border-yellow/50 bg-yellow/10 p-3 text-left">
      <div className="flex items-center justify-between">
        <Label>Proposed Jobber write</Label>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-yellow">{decided ? decided : "waiting for approve"}</span>
      </div>
      {proposal.rationale && <p className="mt-1 text-sm text-ink">{proposal.rationale}</p>}
      <SnapshotDiff before={proposal.before} after={proposal.after} beforeLabel="Before" afterLabel="After" compare={null} />
      {proposal.input.tax_rate_id && <p className="mt-1 text-xs text-muted">Applies tax rate {proposal.input.tax_rate_id}. The after tax is an estimate until Jobber reads back.</p>}
      {!decided && (
        <div className="mt-2 flex gap-2">
          <button onClick={onApprove} disabled={busy} className="rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40">
            {busy ? "Writing…" : "Approve"}
          </button>
          <button onClick={onCancel} disabled={busy} className="rounded-md border border-border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-ink transition hover:border-danger/60 disabled:opacity-40">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Two column before and after: title, lines, subtotal, tax, total. Differences light up. */
function SnapshotDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
  compare,
}: {
  before: QuoteSnapshot | null;
  after: QuoteSnapshot | null;
  beforeLabel: string;
  afterLabel: string;
  compare: CompareResult | null;
}) {
  if (!after && !before) return null;
  const col = (s: QuoteSnapshot | null, other: QuoteSnapshot | null, label: string) => (
    <div className="min-w-0 flex-1 rounded-md border border-border bg-bg p-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
        {label}
        {s?.quoteStatus ? ` · ${s.quoteStatus}` : ""}
      </p>
      {!s ? (
        <p className="mt-1 text-xs text-muted">(nothing read yet)</p>
      ) : (
        <>
          <p className={`mt-1 truncate text-xs ${other && norm(other.title) !== norm(s.title) ? "text-yellow" : "text-ink"}`} title={s.title}>
            {s.title || "(no title)"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {s.lines.map((l, i) => {
              const twin = other?.lines.find((o) => norm(o.name) === norm(l.name) && Math.abs(o.unitPrice * o.quantity - l.unitPrice * l.quantity) <= 0.01);
              return (
                <li key={i} className={`flex justify-between gap-2 text-xs ${other && !twin ? "text-yellow" : "text-ink"}`}>
                  <span className="truncate">
                    {l.name}
                    {l.taxable ? <span className="ml-1 font-mono text-[9px] text-muted">tax</span> : null}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{money(l.unitPrice * l.quantity)}</span>
                </li>
              );
            })}
            {s.lines.length === 0 && <li className="text-xs text-danger">no lines</li>}
          </ul>
          <div className="mt-1.5 space-y-0.5 border-t border-border pt-1 font-mono text-[11px] tabular-nums">
            <Row k="Subtotal" v={money(s.subtotal)} hot={!!other && Math.abs(other.subtotal - s.subtotal) > 0.01} />
            <Row k="Tax" v={money(s.taxAmount)} hot={!!other && Math.abs(other.taxAmount - s.taxAmount) > 0.01} />
            <Row k="Total" v={money(s.total)} hot={!!other && Math.abs(other.total - s.total) > 0.01} />
          </div>
          <p className={`mt-1.5 line-clamp-3 text-[11px] leading-snug ${other && norm(other.message) !== norm(s.message) ? "text-yellow" : "text-muted"}`} title={s.message}>
            {s.message || "(no message)"}
          </p>
        </>
      )}
    </div>
  );
  return (
    <div>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        {col(before, after, beforeLabel)}
        {col(after, before, afterLabel)}
      </div>
      {compare && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          subtotal {compare.subtotalMatch ? "match" : `off ${money(compare.delta)}`} · title {compare.titleMatch ? "match" : "differs"} · message {compare.messageMatch ? "match" : "differs"} · tax{" "}
          {compare.taxMissing ? "missing" : "ok"}
        </p>
      )}
    </div>
  );
}

function Row({ k, v, hot }: { k: string; v: string; hot: boolean }) {
  return (
    <div className={`flex justify-between ${hot ? "text-yellow" : "text-ink"}`}>
      <span className="text-muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function SplitBadge({ reason }: { reason: string | null }) {
  return (
    <span title={reason ?? "Read back text and prices disagree"} className="inline-flex items-center gap-1 rounded-sm border border-yellow/60 bg-yellow/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-yellow">
      <span className="h-1.5 w-1.5 rounded-full bg-yellow" /> Split state
    </span>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm bg-card-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gold">{children}</span>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{children}</div>;
}

const norm = (s: string) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function snapshotFromRead(r: JobberQuoteRead | null): QuoteSnapshot | null {
  if (!r) return null;
  return {
    quoteStatus: r.quoteStatus,
    title: r.title,
    message: r.message,
    lines: r.lineItems.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxable: l.taxable })),
    subtotal: r.subtotal,
    taxAmount: r.taxAmount,
    total: r.total,
  };
}

function expectedSnapshot(r: PushResult): QuoteSnapshot {
  const e = r.expected;
  const taxable = e.lines.filter((l) => l.taxable).reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const rate = r.readBack && r.readBack.taxAmount > 0 ? r.readBack.taxAmount / Math.max(1, r.readBack.lineItems.filter((l) => l.taxable).reduce((s, l) => s + l.unitPrice * l.quantity, 0)) : 0.07;
  const taxAmount = Math.round(taxable * rate * 100) / 100;
  return {
    quoteStatus: "draft",
    title: e.title,
    message: e.message,
    lines: e.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, taxable: l.taxable })),
    subtotal: e.subtotal,
    taxAmount,
    total: Math.round((e.subtotal + taxAmount) * 100) / 100,
  };
}
