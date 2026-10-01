"use client";

import { useEffect, useRef, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { splitBuilds, isCapGroup } from "@/lib/builds";
import { cardPrice, HONEYDONE } from "@/lib/honeydone";
import type { Exclusion, Unit } from "@/lib/types";
import { moneyWhole, reducedMotion, useTween } from "./ui";

export const UNIT_LABEL: Record<Unit, string> = {
  EA: "Each",
  HRS: "Hours",
  SF: "Sq ft",
  LF: "Linear ft",
  SY: "Sq yard",
  CY: "Cubic yard",
  LS: "Lump sum",
  DAY: "Day",
};

const NO_EXCL: Exclusion[] = [];
const money2 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function Tot({ label, value, cls }: { label: string; value: number; cls?: string }) {
  const v = useTween(value);
  return (
    <div className={`tot${cls ? ` ${cls}` : ""}`}>
      <span className="label">{label}</span>
      <b className="num">{moneyWhole(v)}</b>
    </div>
  );
}

export default function Quote({ sel, onSelect, onClose }: { sel: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  const estimate = useEstimateStore((s) => s.estimate);
  const highlight = useEstimateStore((s) => s.highlightIds);
  const pending = useEstimateStore((s) => s.pendingChanges);
  const accept = useEstimateStore((s) => s.acceptChanges);
  const reject = useEstimateStore((s) => s.rejectChanges);
  const split = splitBuilds(estimate);
  const groups = estimate.groups.slice().sort((a, b) => a.position - b.position);
  const totRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLElement>(null);

  // Keep the sticky column header tucked right under the totals strip.
  useEffect(() => {
    const t = totRef.current;
    const b = boxRef.current;
    if (!t || !b) return;
    const ro = new ResizeObserver(() => b.style.setProperty("--totH", `${t.offsetHeight}px`));
    ro.observe(t);
    return () => ro.disconnect();
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".row");
    if (!row) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(row.dataset.id!);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = Array.from(boxRef.current?.querySelectorAll<HTMLElement>(".row") ?? []);
      const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        next.focus();
        if (sel) onSelect(next.dataset.id!);
      }
    } else if (e.key === "Escape") onClose();
  };

  let n = 0;
  return (
    <section className="quote" ref={boxRef} aria-label="Quote">
      <div className="totals" ref={totRef}>
        {split.hasCap && <Tot label="Smooth" value={split.smoothCash} cls="smooth" />}
        <Tot label={split.hasCap ? "Max cost" : "Price"} value={split.maxCash} cls={split.hasCap ? undefined : "smooth"} />
        <Tot label={`Card ${HONEYDONE.cardSurchargePct}%`} value={cardPrice(split.maxCash)} cls="card" />
        {split.maxCash >= HONEYDONE.handymanCapUsd && (
          <span className="capwarn" title="Florida handyman exemption covers jobs under $2,500 total. Refer it out, never split it.">
            Over ${HONEYDONE.handymanCapUsd.toLocaleString()}, refer out
          </span>
        )}
      </div>
      {pending && pending.length > 0 && (
        <div className="review">
          <span>
            <b>{pending.length}</b> AI {pending.length === 1 ? "change" : "changes"} to review
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost sm" onClick={reject}>
              Undo
            </button>
            <button className="btn sm" onClick={accept}>
              Keep
            </button>
          </span>
        </div>
      )}
      {groups.length === 0 ? (
        <div className="qempty">
          <b style={{ color: "var(--fg)" }}>No line items yet.</b>
          <div>Describe the job in the chat and the quote builds here.</div>
        </div>
      ) : (
        <div onKeyDown={onKey}>
          <div className="ghead">
            <span>#</span>
            <span>Item</span>
            <span className="r c-qty">Qty</span>
            <span className="c-unit">Unit</span>
            <span className="r c-rate">Unit $</span>
            <span className="r">Total</span>
            <span className="r" aria-label="Flags">
              ●
            </span>
          </div>
          {groups.map((g) => {
            const cap = isCapGroup(g.name);
            return (
              <div key={g.id}>
                <div className={`group${cap ? " cap" : ""}`}>
                  <span>{g.name}</span>
                  <span className="num">{moneyWhole(g.subtotalClient)}</span>
                </div>
                {g.items
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((it) => {
                    n += 1;
                    return (
                      <div
                        key={it.id}
                        data-id={it.id}
                        tabIndex={0}
                        className={`row${sel === it.id ? " sel" : ""}${it.off ? " off" : ""}${highlight.has(it.id) ? " flash" : ""}`}
                        onClick={() => onSelect(it.id)}
                      >
                        <span className="n">{n}</span>
                        <span>
                          <span className="nm" title={it.name}>
                            {it.name}
                          </span>
                        </span>
                        <span className="r num c-qty">{it.quantity}</span>
                        <span className="unit c-unit">{UNIT_LABEL[it.unit] ?? it.unit}</span>
                        <span className="r num c-rate">{money2(it.unitCost)}</span>
                        <span className="r num t">{moneyWhole(it.clientTotal)}</span>
                        <span className="dots">
                          {it.off ? <i className="dot d-off" title="Off, not in the total" /> : <i className="dot d-live" title="Live, counts in the total" />}
                          {cap && <i className="dot d-alt" title="Max Cost only, if needed" />}
                        </span>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
      <Exclusions />
    </section>
  );
}

function Exclusions() {
  const list = useEstimateStore((s) => s.estimate.exclusions ?? NO_EXCL);
  const hasLines = useEstimateStore((s) => s.estimate.groups.length > 0);
  const toggle = useEstimateStore((s) => s.toggleExclusion);
  const add = useEstimateStore((s) => s.addExclusion);
  const seed = useEstimateStore((s) => s.seedExclusions);
  const [showStruck, setShowStruck] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [text, setText] = useState("");
  if (!hasLines && list.length === 0) return null;
  const struck = list.filter((x) => !x.included).length;

  const onToggle = (id: string, nowIncluded: boolean) => {
    if (!nowIncluded && !showStruck && !reducedMotion()) {
      setLeaving(id);
      setTimeout(() => {
        toggle(id);
        setLeaving(null);
      }, 500);
    } else toggle(id);
  };

  return (
    <div className="excl">
      <h5>
        Exclusions
        {struck > 0 && (
          <button className="linkbtn" onClick={() => setShowStruck((s) => !s)}>
            {showStruck ? "Hide struck" : `+${struck} struck`}
          </button>
        )}
      </h5>
      {list.length === 0 ? (
        <div style={{ padding: "10px 14px" }}>
          <button className="linkbtn" onClick={() => seed()}>
            Suggest exclusions for this job
          </button>
        </div>
      ) : (
        <ul>
          {list
            .filter((x) => x.included || showStruck || leaving === x.id)
            .map((x) => (
              <li key={x.id} className={`${x.included && leaving !== x.id ? "" : "struck"}${leaving === x.id ? " leaving" : ""}`}>
                <input
                  type="checkbox"
                  id={`ex-${x.id}`}
                  checked={x.included && leaving !== x.id}
                  onChange={(e) => onToggle(x.id, e.target.checked)}
                />
                <label htmlFor={`ex-${x.id}`}>
                  <span>{x.text}</span>
                </label>
              </li>
            ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add(text);
          setText("");
        }}
      >
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an exclusion" />
        <button className="btn ghost" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}
