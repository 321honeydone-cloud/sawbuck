"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";

export interface QuoteRow {
  id: string;
  name: string;
  location: string | null;
  status: string;
  total: number;
  items: number;
  date: string;
  creator?: string;
  clientName?: string | null;
}

const STATUS_CLS: Record<string, string> = {
  draft: "border-border text-muted",
  sent: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  won: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  complete: "border-brand/40 bg-brand/10 text-brand",
  invoiced: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  archived: "border-border text-muted",
};
const statusCls = (s: string) => STATUS_CLS[s] ?? "border-border text-muted";

export default function QuoteList({ quotes: initial, showCreator }: { quotes: QuoteRow[]; showCreator?: boolean }) {
  const router = useRouter();
  const [quotes, setQuotes] = useState(initial);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const del = async (id: string) => {
    setBusy(true);
    try {
      await fetch("/api/estimate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setQuotes((q) => q.filter((x) => x.id !== id));
      setConfirmId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (quotes.length === 0) {
    return <p className="py-20 text-center text-sm text-muted">No saved quotes yet. Build one in the estimator.</p>;
  }

  return (
    <div className="space-y-2">
      {quotes.map((q) => (
        <div key={q.id} className="flex items-stretch overflow-hidden rounded-lg border border-border bg-card">
          <Link
            href={`/estimate/${q.id}`}
            className="flex min-w-0 flex-1 items-center justify-between px-4 py-3 transition hover:bg-card-2"
          >
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-semibold uppercase tracking-[0.04em]">{q.name}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                {q.id} · {q.clientName || q.location || "FL"} · {q.items} {q.items === 1 ? "line" : "lines"} · {q.date}
                {showCreator && q.creator && <span className="text-gold"> · {q.creator}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 pl-3">
              <span className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${statusCls(q.status)}`}>
                {q.status}
              </span>
              <span className="font-display text-base font-semibold tabular-nums text-brand">{money(q.total)}</span>
            </div>
          </Link>

          {confirmId === q.id ? (
            <div className="flex items-center gap-1 border-l border-border px-2">
              <button
                onClick={() => del(q.id)}
                disabled={busy}
                className="rounded bg-flag/20 px-2 py-1 text-xs font-semibold text-flag transition hover:bg-flag/30 disabled:opacity-50"
              >
                {busy ? "…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmId(null)}
                className="rounded border border-border px-2 py-1 text-xs text-muted transition hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmId(q.id)}
              aria-label={`Delete ${q.name}`}
              className="grid w-12 place-items-center border-l border-border text-muted transition hover:bg-flag/10 hover:text-flag"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M10 11v6M14 11v6" />
                <path d="M6 7l1 13h10l1-13" />
                <path d="M9 7V4h6v3" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
