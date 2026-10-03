"use client";

// Owner-only "is Sawbuck actually learning?" card on the Admin page. Shows how
// many quotes are in, how many prices it has learned and how many are backed by
// more than one job or an invoiced one, the state of the lessons memory, and a
// short list of plain-word verdicts. "Distill now" turns the memory log into
// lessons on the spot instead of waiting for the next 10 events.
import { useEffect, useState } from "react";

type Level = "ok" | "warn" | "bad";

type Health = {
  brain: "claude" | "ollama";
  quotes: { total: number; byStatus: Record<string, number>; last30: number; lastActivity: string | null };
  learnedRates: {
    total: number;
    last30: number;
    multiJob: number;
    wonBacked: number;
    top: { name: string; unit: string; costType: string; price: number; used: number; jobs: number; won: number; low: number; high: number }[];
  };
  rateBook: { fromQuotes: number; newFromJobs: number; fromQuotes30: number; screenEdits: number; research: number };
  memory: {
    path: string;
    logEntries: number;
    pending: number;
    lessons: number;
    lastEventAt: string | null;
    compactEvery: number;
    lastCompactedAt: string | null;
    lastBrain: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  } | null;
  verdicts: { level: Level; text: string }[];
};

const DOT: Record<Level, string> = { ok: "bg-gain", warn: "bg-flag", bad: "bg-danger" };

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "never";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 font-display text-xl font-bold text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}

export default function LearningHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function load() {
    setErr("");
    try {
      const r = await fetch("/api/admin/learning", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setH((await r.json()) as Health);
    } catch (e) {
      setErr(`Could not load learning health (${(e as Error).message}).`);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function distill() {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/admin/learning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "compact" }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setNote(j.ok ? "Lessons updated." : `Distill failed: ${j.error ?? `HTTP ${r.status}`}`);
    } catch (e) {
      setNote(`Distill failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      load();
    }
  }

  if (err) return <p className="text-xs text-danger">{err}</p>;
  if (!h) return <p className="text-xs text-muted">Checking what Sawbuck has learned...</p>;

  const s = h.quotes.byStatus;
  const m = h.memory;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
        {h.verdicts.map((v, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-ink">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[v.level]}`} />
            <span>{v.text}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Quotes" value={h.quotes.total} sub={`${h.quotes.last30} in last 30 days`} />
        <Stat label="Invoiced" value={s.invoiced ?? 0} sub={`${s.sent ?? 0} sent, ${s.complete ?? 0} complete, ${s.draft ?? 0} draft`} />
        <Stat label="Learned prices" value={h.learnedRates.total} sub={`${h.learnedRates.multiJob} from 2+ jobs, ${h.learnedRates.wonBacked} won-backed`} />
        <Stat label="Rate Book from jobs" value={h.rateBook.fromQuotes} sub={`${h.rateBook.newFromJobs} new tasks added`} />
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Lessons memory</div>
          <button
            type="button"
            onClick={distill}
            disabled={busy || !m || m.logEntries === 0}
            className="rounded border border-gold px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-gold hover:bg-gold hover:text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Distilling..." : "Distill now"}
          </button>
        </div>
        {m ? (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink sm:grid-cols-3">
            <div><span className="text-muted">Lessons:</span> {m.lessons}</div>
            <div><span className="text-muted">Job events logged:</span> {m.logEntries}</div>
            <div><span className="text-muted">Waiting to distill:</span> {m.pending} of {m.compactEvery}</div>
            <div><span className="text-muted">Last event:</span> {fmtDate(m.lastEventAt)}</div>
            <div><span className="text-muted">Last distilled:</span> {fmtDate(m.lastCompactedAt)}{m.lastBrain ? ` (${m.lastBrain})` : ""}</div>
            <div><span className="text-muted">Brain now:</span> {h.brain === "claude" ? "Claude" : "Local"}</div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-danger">Memory file could not be read.</p>
        )}
        {m?.lastError ? (
          <p className="mt-2 text-[11px] text-muted">
            Last failure {fmtDate(m.lastErrorAt)}: <span className="text-danger">{m.lastError}</span>
          </p>
        ) : null}
        {note ? <p className="mt-2 text-xs text-gold">{note}</p> : null}
      </div>

      {h.learnedRates.top.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Most used learned prices</div>
          <div className="mt-2 divide-y divide-border">
            {h.learnedRates.top.map((r) => (
              <div key={`${r.costType}|${r.unit}|${r.name}`} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate text-ink">{r.name}</div>
                  <div className="text-[11px] text-muted">
                    {r.jobs > 0 ? `${r.jobs} job${r.jobs === 1 ? "" : "s"}` : "older price"}
                    {r.won > 0 ? `, ${r.won} invoiced` : ""}
                    {r.jobs >= 2 && r.low !== r.high ? `, range ${money(r.low)} to ${money(r.high)}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono text-ink">
                  {money(r.price)} <span className="text-muted">/{r.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-muted">
        Prices are the middle of recent jobs, not the last one typed. Your edits count double an AI line, Invoiced jobs
        count triple, deleted ones count half, and a price set on the Rate Book screen counts like four jobs.
      </p>
    </div>
  );
}
