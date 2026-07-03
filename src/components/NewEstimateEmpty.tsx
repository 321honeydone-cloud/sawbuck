"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createEstimate } from "@/lib/createEstimate";

export default function NewEstimateEmpty() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const start = async () => {
    setCreating(true);
    const id = await createEstimate();
    if (id) router.push(`/estimate/${id}`);
    else setCreating(false);
  };

  return (
    <main className="grid h-dvh place-items-center text-ink">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Sawbuck AI" className="mx-auto mb-3 h-16 w-16 rounded-2xl object-contain" />
        <div className="font-display text-xl font-bold uppercase tracking-[0.1em]">Sawbuck AI</div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">No estimates yet</div>
        <p className="mt-3 text-sm text-muted">Start one and describe the job. The AI builds it at your pricing.</p>
        <button
          onClick={start}
          disabled={creating}
          className="mt-5 rounded-md bg-brand px-4 py-2 font-display text-sm font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-50"
        >
          {creating ? "Creating…" : "New Estimate"}
        </button>
      </div>
    </main>
  );
}
