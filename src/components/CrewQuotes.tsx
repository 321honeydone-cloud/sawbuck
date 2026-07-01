"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";

export interface CrewMessage {
  role: string; // user | ai | system
  content: string;
}
export interface CrewQuote {
  id: string;
  name: string;
  location: string | null;
  status: string;
  total: number;
  items: number;
  date: string;
  transcript: CrewMessage[];
  summary?: { mainAsk: string; turns: number; pricePushback: boolean };
}
export interface UserQuoteGroup {
  key: string; // user id, or "owner" / "unassigned"
  name: string;
  role: string; // admin | user | owner | ""
  quotes: CrewQuote[];
}

// Admin: each crew member drops down the quotes they built. Each quote opens to
// the editor (review/change) and has a transcript toggle to read what they asked
// the AI and how it answered.
export default function CrewQuotes({ groups }: { groups: UserQuoteGroup[] }) {
  const router = useRouter();
  const [openUser, setOpenUser] = useState<Record<string, boolean>>({});
  const [openTx, setOpenTx] = useState<Record<string, boolean>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gist, setGist] = useState<Record<string, string>>({});
  const [gistBusy, setGistBusy] = useState<Record<string, boolean>>({});

  const summarize = async (id: string) => {
    setGistBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await fetch("/api/admin/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimateId: id }),
      });
      const d = (await r.json().catch(() => ({}))) as { summary?: string };
      setGist((g) => ({ ...g, [id]: d.summary || "No summary available." }));
    } finally {
      setGistBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const del = async (id: string) => {
    setBusy(true);
    try {
      await fetch("/api/estimate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setConfirmId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (groups.length === 0) {
    return <p className="text-sm text-muted">No crew yet. Add users above and their quotes will show here.</p>;
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const uOpen = !!openUser[g.key];
        return (
          <div key={g.key} className="overflow-hidden rounded-lg border border-border bg-card">
            <button
              onClick={() => setOpenUser((o) => ({ ...o, [g.key]: !o[g.key] }))}
              aria-expanded={uOpen}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-card-2"
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block text-[10px] text-muted transition-transform ${uOpen ? "rotate-90 text-gold" : ""}`}>▶</span>
                <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-ink">{g.name}</span>
                {g.role && (
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${g.role === "admin" || g.role === "owner" ? "bg-brand/15 text-brand" : "bg-card-2 text-muted"}`}>
                    {g.role === "owner" ? "you" : g.role}
                  </span>
                )}
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                {g.quotes.length} {g.quotes.length === 1 ? "quote" : "quotes"}
              </span>
            </button>

            {uOpen && (
              <div className="space-y-2 border-t border-border px-3 py-3">
                {g.quotes.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-muted">No quotes from this user yet.</p>
                ) : (
                  g.quotes.map((q) => {
                    const txOpen = !!openTx[q.id];
                    return (
                      <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-card-2/40">
                        <div className="flex items-stretch">
                          <Link
                            href={`/estimate/${q.id}`}
                            className="flex min-w-0 flex-1 items-center justify-between px-3 py-2.5 transition hover:bg-card-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-display text-sm font-semibold uppercase tracking-[0.04em]">{q.name}</div>
                              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                                {q.id} · {q.items} {q.items === 1 ? "line" : "lines"} · {q.date}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 pl-3">
                              <span className="rounded border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">{q.status}</span>
                              <span className="font-display text-base font-semibold tabular-nums text-brand">{money(q.total)}</span>
                            </div>
                          </Link>

                          <button
                            onClick={() => setOpenTx((o) => ({ ...o, [q.id]: !o[q.id] }))}
                            aria-expanded={txOpen}
                            aria-label="Transcript"
                            title="Transcript"
                            className={`grid w-11 place-items-center border-l border-border transition hover:bg-card-2 ${txOpen ? "text-gold" : "text-muted hover:text-ink"}`}
                          >
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
                            </svg>
                          </button>

                          {confirmId === q.id ? (
                            <div className="flex items-center gap-1 border-l border-border px-2">
                              <button onClick={() => del(q.id)} disabled={busy} className="rounded bg-flag/20 px-2 py-1 text-xs font-semibold text-flag transition hover:bg-flag/30 disabled:opacity-50">
                                {busy ? "…" : "Delete"}
                              </button>
                              <button onClick={() => setConfirmId(null)} className="rounded border border-border px-2 py-1 text-xs text-muted transition hover:text-ink">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmId(q.id)} aria-label={`Delete ${q.name}`} className="grid w-10 place-items-center border-l border-border text-muted transition hover:bg-flag/10 hover:text-flag">
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {q.summary && (
                          <div className="border-t border-border/60 bg-card-2/20 px-3 py-2 text-xs">
                            {q.summary.mainAsk && (
                              <p className="text-ink/90">
                                <span className="text-muted">Asked: </span>
                                {q.summary.mainAsk}
                              </p>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                                {q.summary.turns} {q.summary.turns === 1 ? "turn" : "turns"}
                              </span>
                              {q.summary.turns >= 4 && (
                                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                                  several changes
                                </span>
                              )}
                              {q.summary.pricePushback && (
                                <span className="rounded border border-flag/40 bg-flag/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-flag">
                                  price pushback
                                </span>
                              )}
                              {!gist[q.id] && (
                                <button
                                  onClick={() => summarize(q.id)}
                                  disabled={!!gistBusy[q.id]}
                                  className="rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-brand transition hover:bg-brand/20 disabled:opacity-40"
                                >
                                  {gistBusy[q.id] ? "…" : "AI summary"}
                                </button>
                              )}
                            </div>
                            {gist[q.id] && <p className="mt-1.5 rounded bg-bg/50 px-2 py-1.5 text-ink/90">{gist[q.id]}</p>}
                          </div>
                        )}

                        {txOpen && (
                          <div className="max-h-72 space-y-2.5 overflow-y-auto border-t border-border bg-bg/50 px-3 py-3">
                            {q.transcript.length === 0 ? (
                              <p className="text-xs text-muted">No transcript for this quote.</p>
                            ) : (
                              q.transcript.map((m, i) => (
                                <div key={i} className="text-sm leading-relaxed">
                                  <span className={`mr-2 font-mono text-[9px] uppercase tracking-[0.12em] ${m.role === "ai" ? "text-gold" : m.role === "system" ? "text-muted" : "text-brand"}`}>
                                    {m.role === "ai" ? "AI" : m.role === "system" ? "System" : "Crew"}
                                  </span>
                                  <span className="whitespace-pre-wrap text-ink/90">{m.content}</span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
