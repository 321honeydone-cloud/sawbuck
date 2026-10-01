"use client";

import { useEffect, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { computeTotals } from "@/lib/totals";
import { splitBuilds, type BuildSplit } from "@/lib/builds";
import type { JobberQuote } from "@/lib/jobber";
import type { Estimate, Exclusion } from "@/lib/types";
import { moneyWhole, toast, usePresence } from "./ui";

const NO_EXCL: Exclusion[] = [];
const m2 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Only the live (not struck) lines go on the client quote. */
const liveOnly = (e: Estimate): Estimate => {
  const groups = e.groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.off) })).filter((g) => g.items.length > 0);
  return { ...e, groups, totals: computeTotals(groups) };
};

/** Plain text block ready to paste into Jobber or a text. Mirrors the classic Finalize. */
function asText(q: JobberQuote, split: BuildSplit, excl: string[]) {
  const price = split.hasCap
    ? [
        `EXPECTED PRICE (Smooth Scenario): ${m2(split.smoothCash)} (cash/check) | ${m2(split.smoothCard)} (card)`,
        `MAX PRICE GUARANTEE (the most you will ever pay): ${m2(split.maxCash)} (cash/check) | ${m2(split.maxCard)} (card)`,
        "",
        "The Max Price Guarantee only applies if these specific issues are found once work starts. Anything not needed drops off your bill:",
        ...split.capItems.map((i) => `- ${i.name}: up to +${m2(i.clientTotal)}`),
      ]
    : [`PRICE: ${m2(q.priceCash)} (cash/check) | ${m2(q.priceCard)} (card)`];
  return [`CLIENT: ${q.client}`, "", `QUOTE TITLE: ${q.quoteTitle}`, "", "SCOPE OF WORK:", q.scopeOfWork, "", ...price, "", "EXCLUSIONS:", ...excl.map((x) => `- ${x}`)].join("\n");
}

export default function Finalize({ open, onClose }: { open: boolean; onClose: () => void }) {
  const estimate = useEstimateStore((s) => s.estimate);
  const exclusions = useEstimateStore((s) => s.estimate.exclusions ?? NO_EXCL);
  const seed = useEstimateStore((s) => s.seedExclusions);
  const setStatus = useEstimateStore((s) => s.setStatus);
  const [quote, setQuote] = useState<JobberQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { render, closing } = usePresence(open, 180);

  useEffect(() => {
    if (!open) return;
    setQuote(null);
    setErr(null);
    seed();
    fetch("/api/jobber", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estimate: liveOnly(estimate) }) })
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not build the quote. Try again.");
        const d = (await r.json()) as { quote: JobberQuote };
        setQuote(d.quote);
        if (d.quote.exclusions?.length) seed(d.quote.exclusions);
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  if (!render) return null;
  const split = splitBuilds(liveOnly(estimate));
  const excl = exclusions.filter((x) => x.included).map((x) => x.text);

  const copy = async () => {
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(asText(quote, split, excl));
      toast("Quote copied. Paste it into Jobber.");
    } catch {
      toast("Copy was blocked. Select the text and copy it by hand.");
    }
  };

  return (
    <div className={`overlay${closing ? " out" : ""}`} onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Finalize quote" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h3>Finalize quote</h3>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Scope, price and exclusions. Nothing internal.
            </span>
          </div>
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dbody">
          {err && <div style={{ color: "var(--bad)" }}>{err}</div>}
          {!quote && !err && (
            <span className="working">
              <span className="spin" />
              Writing the client scope
            </span>
          )}
          {quote && (
            <>
              <div className="fbox">
                <span className="label">Client</span>
                <p>{quote.client}</p>
              </div>
              <div className="fbox">
                <span className="label">Quote title</span>
                <p>{quote.quoteTitle}</p>
              </div>
              <div className="fbox">
                <span className="label">Scope of work</span>
                <p>{quote.scopeOfWork}</p>
              </div>
            </>
          )}
          <div className="prices">
            {split.hasCap && (
              <div className="fbox">
                <span className="label">Expected (Smooth)</span>
                <p>
                  <b className="num" style={{ color: "var(--accent-text)" }}>
                    {moneyWhole(split.smoothCash)}
                  </b>{" "}
                  <span className="muted">{moneyWhole(split.smoothCard)} card</span>
                </p>
              </div>
            )}
            <div className="fbox">
              <span className="label">{split.hasCap ? "Max price guarantee" : "Price"}</span>
              <p>
                <b className="num">{moneyWhole(split.maxCash)}</b> <span className="muted">{moneyWhole(split.maxCard)} card</span>
              </p>
            </div>
          </div>
          {split.hasCap && split.capItems.length > 0 && (
            <div className="fbox">
              <span className="label">Only if found</span>
              {split.capItems.map((i) => (
                <p key={i.id}>
                  {i.name}: up to +{m2(i.clientTotal)}
                </p>
              ))}
            </div>
          )}
          <div className="fbox">
            <span className="label">Exclusions ({excl.length})</span>
            {excl.length ? excl.map((x) => <p key={x}>- {x}</p>) : <p className="muted">None checked. Edit them under the quote.</p>}
          </div>
        </div>
        <footer>
          <button
            className="btn ghost"
            onClick={() => {
              setStatus("sent");
              toast("Marked Sent");
              onClose();
            }}
          >
            Mark as sent
          </button>
          <button className="btn" onClick={copy} disabled={!quote}>
            Copy quote
          </button>
        </footer>
      </div>
    </div>
  );
}
