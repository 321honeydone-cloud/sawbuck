"use client";

import { useEffect, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { money } from "@/lib/format";
import { computeTotals } from "@/lib/totals";
import { splitBuilds, type BuildSplit } from "@/lib/builds";
import type { JobberQuote } from "@/lib/jobber";

/** Format the finalized quote as the plain-text block ready to send or paste. */
function asText(q: JobberQuote, split: BuildSplit, exclusionTexts: string[]): string {
  const priceBlock = split.hasCap
    ? [
        `EXPECTED PRICE (Smooth Scenario): ${money(split.smoothCash)} (cash/check) | ${money(split.smoothCard)} (card)`,
        `MAX COST GUARANTEE (the most you will ever pay): ${money(split.maxCash)} (cash/check) | ${money(split.maxCard)} (card)`,
        "",
        "The Max Cost Guarantee only applies if these specific issues are found once work starts. Anything not needed drops off your bill:",
        ...split.capItems.map((i) => `- ${i.name}: up to +${money(i.clientTotal)}`),
      ]
    : [`PRICE: ${money(q.priceCash)} (cash/check) | ${money(q.priceCard)} (card)`];
  return [
    `CLIENT: ${q.client}`,
    "",
    `QUOTE TITLE: ${q.quoteTitle}`,
    "",
    "SCOPE OF WORK:",
    q.scopeOfWork,
    "",
    ...priceBlock,
    "",
    "EXCLUSIONS:",
    ...exclusionTexts.map((e) => `- ${e}`),
  ].join("\n");
}

export default function JobberModal({
  open,
  onClose,
  excluded,
}: {
  open: boolean;
  onClose: () => void;
  excluded?: Set<string>;
}) {
  const estimate = useEstimateStore((s) => s.estimate);
  const exclusions = useEstimateStore((s) => s.estimate.exclusions ?? []);
  const seedExclusions = useEstimateStore((s) => s.seedExclusions);
  const addExclusion = useEstimateStore((s) => s.addExclusion);
  const toggleExclusion = useEstimateStore((s) => s.toggleExclusion);

  // Only quote the sections that are toggled on.
  const includedEstimate = () => {
    if (!excluded || excluded.size === 0) return estimate;
    const groups = estimate.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => !excluded.has(i.id)) }))
      .filter((g) => g.items.length > 0);
    return { ...estimate, groups, totals: computeTotals(groups) };
  };

  const [quote, setQuote] = useState<JobberQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newExcl, setNewExcl] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuote(null);
    setError(null);
    setCopied(false);
    setLoading(true);
    // Seed the deterministic, trade-aware exclusions right away so the list
    // shows even if the wording call is slow or offline.
    seedExclusions();
    fetch("/api/jobber", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimate: includedEstimate() }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not build the quote.");
        const data = (await res.json()) as { quote: JobberQuote };
        setQuote(data.quote);
        // Fold any AI-suggested exclusions into the editable list too.
        if (data.quote.exclusions?.length) seedExclusions(data.quote.exclusions);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const split = splitBuilds(includedEstimate());
  const includedTexts = exclusions.filter((e) => e.included).map((e) => e.text);

  const addNow = () => {
    addExclusion(newExcl);
    setNewExcl("");
  };

  const copy = async () => {
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(asText(quote, split, includedTexts));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy failed. Select the text and copy manually.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div>
            <h2 className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-ink">Finalize Quote</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Two builds, scope, and exclusions</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              disabled={!quote}
              className="rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
            >
              {copied ? "Copied ✓" : "Copy quote"}
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-border px-2.5 py-1.5 text-sm text-muted transition hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {loading && !quote && <p className="py-6 text-center text-sm text-muted">Writing the scope…</p>}
          {error && <p className="pb-3 text-center text-sm text-flag">{error}</p>}

          <div className="space-y-4 text-sm">
            {quote && (
              <>
                <Field label="Quote title" value={quote.quoteTitle} />
                <div>
                  <Label>Scope of work</Label>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink">{quote.scopeOfWork}</p>
                </div>
                {split.hasCap ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-brand/50 bg-brand/10 p-3">
                      <div className="flex items-baseline justify-between">
                        <Label>Smooth Scenario · expected price</Label>
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">if it goes as planned</span>
                      </div>
                      <p className="mt-1 font-display text-xl font-semibold tabular-nums text-brand">
                        {money(split.smoothCash)} <span className="text-sm font-normal text-muted">cash/check</span>
                        <span className="mx-2 text-muted">|</span>
                        {money(split.smoothCard)} <span className="text-sm font-normal text-muted">card</span>
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-card-2 p-3">
                      <div className="flex items-baseline justify-between">
                        <Label>Max Cost Guarantee · ceiling</Label>
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">the most you will ever pay</span>
                      </div>
                      <p className="mt-1 font-display text-lg font-semibold tabular-nums text-ink">
                        {money(split.maxCash)} <span className="text-sm font-normal text-muted">cash/check</span>
                        <span className="mx-2 text-muted">|</span>
                        {money(split.maxCard)} <span className="text-sm font-normal text-muted">card</span>
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        Only charged if these specific issues turn up once work starts. Anything not needed drops off the bill.
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {split.capItems.map((i) => (
                          <li key={i.id} className="flex items-start justify-between gap-3 text-xs">
                            <span className="text-ink">{i.name}</span>
                            <span className="shrink-0 font-mono tabular-nums text-gold">up to +{money(i.clientTotal)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label>Price</Label>
                    <p className="mt-1 font-display text-base tabular-nums text-ink">
                      {money(quote.priceCash)} <span className="text-muted">cash/check</span>
                      <span className="mx-2 text-muted">|</span>
                      {money(quote.priceCard)} <span className="text-muted">card</span>
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Single price. To show a Smooth vs Max build, ask the estimator to add a Complications Cap section for the risky items.
                    </p>
                  </div>
                )}
              </>
            )}

            <div>
              <Label>Exclusions</Label>
              <p className="mt-0.5 text-xs text-muted">Check to keep on the quote, uncheck to strike it. Add your own below.</p>
              <ul className="mt-2 space-y-1.5">
                {exclusions.length === 0 && <li className="text-xs text-muted">No exclusions yet.</li>}
                {exclusions.map((ex) => (
                  <li key={ex.id} className="flex items-start gap-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={ex.included}
                      onClick={() => toggleExclusion(ex.id)}
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[11px] font-bold leading-none transition ${
                        ex.included ? "border-brand bg-brand text-black" : "border-border bg-card-2 text-transparent"
                      }`}
                    >
                      ✓
                    </button>
                    <span className={ex.included ? "text-ink" : "text-muted line-through"}>{ex.text}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <input
                  value={newExcl}
                  onChange={(e) => setNewExcl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addNow();
                    }
                  }}
                  placeholder="Add an exclusion"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-card-2 px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
                />
                <button
                  onClick={addNow}
                  disabled={!newExcl.trim()}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-ink transition hover:border-brand/60 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{children}</div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-1 text-ink">{value}</p>
    </div>
  );
}
