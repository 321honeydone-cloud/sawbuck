"use client";

import { useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { money } from "@/lib/format";
import { cardPrice } from "@/lib/honeydone";
import { SERVICE_TIERS, tierConfig } from "@/lib/tiers";
import { recalcEstimate } from "@/lib/totals";
import type { Estimate, ServiceTier, TierVariant } from "@/lib/types";

// Generated tier variants survive the session per estimate so switching is
// instant and a reload simply rebuilds on demand.
const tierCache = new Map<string, TierVariant[]>();

async function persist(estimate: Estimate) {
  try {
    await fetch("/api/estimate", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(estimate),
    });
  } catch {
    /* best effort */
  }
}

export default function TierBar() {
  const estimate = useEstimateStore((s) => s.estimate);
  const hasItems = estimate.groups.some((g) => g.items.length > 0);
  const [variants, setVariants] = useState<TierVariant[] | null>(() => tierCache.get(estimate.id) ?? null);
  const [loading, setLoading] = useState(false);
  const [engine, setEngine] = useState<"ai" | "fallback" | null>(null);
  const selected: ServiceTier = estimate.selectedTier ?? "standard";

  if (!hasItems) return null;

  const build = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tiers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimate }),
      });
      const data = (await res.json()) as { tiers?: TierVariant[]; engine?: "ai" | "fallback" };
      if (data.tiers && data.tiers.length) {
        tierCache.set(estimate.id, data.tiers);
        setVariants(data.tiers);
        setEngine(data.engine ?? null);
        // Mark the current build as Standard without disturbing the line items.
        if (!estimate.selectedTier) {
          useEstimateStore.setState({ estimate: { ...useEstimateStore.getState().estimate, selectedTier: "standard" } });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const pick = (variant: TierVariant) => {
    if (variant.tier === selected) return;
    const base = useEstimateStore.getState().estimate;
    const next = recalcEstimate({
      ...base,
      groups: variant.groups,
      totals: variant.totals,
      selectedTier: variant.tier,
    });
    useEstimateStore.setState({ estimate: next, pendingChanges: null, snapshot: null, highlightIds: new Set() });
    void persist(next);
  };

  const priceOf = (tier: ServiceTier): number | null => {
    const v = variants?.find((x) => x.tier === tier);
    return v ? v.totals.estimateTotal : null;
  };

  return (
    <div className="border-b border-border bg-card px-5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold">Service tiers</div>
        {variants ? (
          <button
            onClick={build}
            disabled={loading}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted transition hover:text-ink disabled:opacity-40"
          >
            {loading ? "rebuilding…" : "↻ rebuild"}
          </button>
        ) : (
          <button
            onClick={build}
            disabled={loading}
            className="rounded-md border border-brand/60 bg-brand/10 px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-brand transition hover:bg-brand/20 disabled:opacity-50"
          >
            {loading ? "Building tiers…" : "Build 3 tiers"}
          </button>
        )}
      </div>

      {!variants && !loading && (
        <p className="text-xs text-muted">
          Build Competitive, Standard, and Premium versions of this estimate, then check one to use on the quote.
        </p>
      )}

      {variants && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SERVICE_TIERS.map((t) => {
              const active = selected === t.key;
              const price = priceOf(t.key);
              const variant = variants.find((v) => v.tier === t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => variant && pick(variant)}
                  aria-pressed={active}
                  className={`rounded-lg border p-3 text-left transition ${
                    active
                      ? "border-brand bg-brand/10 ring-1 ring-brand/50"
                      : "border-border bg-card hover:border-brand/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-semibold uppercase tracking-[0.05em] text-ink">
                      {t.label}
                    </span>
                    <span
                      className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] ${
                        active ? "border-brand bg-brand text-black" : "border-muted text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                  </div>
                  <div className="mt-1 font-display text-lg font-semibold tabular-nums text-brand">
                    {price !== null ? money(price) : "—"}
                  </div>
                  {price !== null && (
                    <div className="font-mono text-[10px] text-muted">{money(cardPrice(price))} card</div>
                  )}
                  <p className="mt-1.5 text-xs leading-snug text-muted">{t.blurb}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            Showing {tierConfig(selected).label} on the sheet · the Jobber quote uses the checked tier
            {engine === "fallback" ? " · offline build" : ""}
          </p>
        </>
      )}
    </div>
  );
}
