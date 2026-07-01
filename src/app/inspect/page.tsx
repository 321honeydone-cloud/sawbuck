"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface InsRow {
  id: string;
  name: string;
  location: string | null;
  status: string;
  issueCount: number;
  updatedAt: string;
}

export default function InspectListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InsRow[]>([]);
  const [creating, setCreating] = useState(false);

  const load = () =>
    fetch("/api/inspection")
      .then((r) => (r.ok ? r.json() : { inspections: [] }))
      .then((d) => setRows(d.inspections ?? []))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  const onNew = async () => {
    setCreating(true);
    const r = await fetch("/api/inspection", { method: "POST" });
    if (r.ok) {
      const { id } = (await r.json()) as { id: string };
      router.push(`/inspect/${id}`);
    } else setCreating(false);
  };

  const del = async (id: string) => {
    await fetch("/api/inspection", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void load();
  };

  return (
    <main className="h-full overflow-y-auto text-ink">
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-2.5">
        <h1 className="font-display text-base font-bold uppercase tracking-[0.08em]">Inspections</h1>
        <button
          onClick={onNew}
          disabled={creating}
          className="rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-50"
        >
          {creating ? "…" : "+ New Inspection"}
        </button>
      </header>
      <div className="mx-auto max-w-3xl space-y-2 px-5 py-6">
        {rows.length === 0 && (
          <p className="py-16 text-center text-sm text-muted">No inspections yet. Start one and walk the property.</p>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex items-stretch overflow-hidden rounded-lg border border-border bg-card">
            <Link href={`/inspect/${r.id}`} className="min-w-0 flex-1 px-4 py-3 transition hover:bg-card-2">
              <div className="truncate font-display text-sm font-semibold uppercase tracking-[0.04em]">{r.name}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                {r.id} · {r.location || "no address"} · {r.issueCount} {r.issueCount === 1 ? "issue" : "issues"} ·{" "}
                {new Date(r.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </Link>
            <button
              onClick={() => del(r.id)}
              aria-label={`Delete ${r.name}`}
              className="grid w-12 place-items-center border-l border-border text-muted transition hover:bg-flag/10 hover:text-flag"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
