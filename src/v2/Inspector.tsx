"use client";

import { useEffect, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { applyOperation } from "@/lib/operations";
import { isCapGroup } from "@/lib/builds";
import { cardPrice } from "@/lib/honeydone";
import { deterministicSteps, type StepsResult } from "@/lib/steps";
import type { LineItem, Unit } from "@/lib/types";
import { UNIT_LABEL } from "./Quote";
import { toast } from "./ui";

const stepCache = new Map<string, StepsResult>();
const money2 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function Inspector({ id, className, onClose }: { id: string; className: string; onClose: () => void }) {
  const estimate = useEstimateStore((s) => s.estimate);
  const edit = useEstimateStore((s) => s.editLineItem);
  const setOff = useEstimateStore((s) => s.setLinesOff);
  const group = estimate.groups.find((g) => g.items.some((i) => i.id === id));
  const item = group?.items.find((i) => i.id === id);

  // Line vanished (deleted, or an AI undo): close the panel.
  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);
  if (!item || !group) return <aside className={`insp ${className}`} />;

  const cap = isCapGroup(group.name);
  const n = (v: string) => {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : null;
  };

  const del = () => {
    const st = useEstimateStore.getState();
    const { estimate: next } = applyOperation(st.estimate, { op: "delete_line_item", id: item.id });
    useEstimateStore.setState({ estimate: next });
    void fetch("/api/estimate", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
    toast("Line deleted");
    onClose();
  };

  return (
    <aside className={`insp ${className}`} aria-label="Line details">
      <div className="phead">
        <h4>Line details</h4>
        <button className="btn ghost sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="body">
        <div>
          <div className="label" style={{ marginBottom: 4 }}>
            {group.name}
          </div>
          <textarea
            key={`nm-${item.id}-${item.name}`}
            className="field"
            defaultValue={item.name}
            aria-label="Line description"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== item.name) edit(item.id, "name", v);
            }}
          />
        </div>
        <div className="edit">
          <label>
            <span className="label">Qty</span>
            <input
              key={`q-${item.id}-${item.quantity}`}
              className="field num"
              type="number"
              step="any"
              defaultValue={item.quantity}
              onBlur={(e) => {
                const v = n(e.target.value);
                if (v !== null && v !== item.quantity) edit(item.id, "quantity", v);
              }}
            />
          </label>
          <label>
            <span className="label">Unit</span>
            <select className="field" value={item.unit} onChange={(e) => edit(item.id, "unit", e.target.value as Unit)}>
              {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Unit $</span>
            <input
              key={`c-${item.id}-${item.unitCost}`}
              className="field num"
              type="number"
              step="any"
              defaultValue={item.unitCost}
              onBlur={(e) => {
                const v = n(e.target.value);
                if (v !== null && v !== item.unitCost) edit(item.id, "unitCost", v);
              }}
            />
          </label>
          <label>
            <span className="label">Markup %</span>
            <input
              key={`m-${item.id}-${item.markupPct}`}
              className="field num"
              type="number"
              step="any"
              defaultValue={item.markupPct}
              onBlur={(e) => {
                const v = n(e.target.value);
                if (v !== null && v !== item.markupPct) edit(item.id, "markupPct", v);
              }}
            />
          </label>
        </div>

        <div>
          <div className="label" style={{ marginBottom: 6 }}>
            Flags
          </div>
          <div className="flags">
            <button
              className={`flag${item.off ? "" : " on"}`}
              data-f="live"
              role="switch"
              aria-checked={!item.off}
              onClick={() => setOff([item.id], !item.off)}
            >
              <i className="dot d-live" />
              <span>
                Live<small>Counts in the total and the client quote</small>
              </span>
              <i className="sw" />
            </button>
            <div className={`flag${cap ? " on" : ""}`} data-f="alt" title="Set by which group the line is in">
              <i className="dot d-alt" />
              <span>
                Max Cost only<small>{cap ? "In the Complications Cap, charged only if needed" : "Base scope, part of the Smooth price"}</small>
              </span>
              <i className="sw" style={{ opacity: 0.6 }} />
            </div>
          </div>
        </div>

        <Steps item={item} />

        <div className="math">
          <div>
            <span>
              {item.quantity} {UNIT_LABEL[item.unit] ?? item.unit} x {money2(item.unitCost)}
            </span>
            <span>{money2(item.builderCost)}</span>
          </div>
          <div>
            <span>Markup {item.markupPct}%</span>
            <span>{money2(item.markupAmount)}</span>
          </div>
          <div className="t">
            <span>Client</span>
            <span>{money2(item.clientTotal)}</span>
          </div>
          <div>
            <span>Card 3%</span>
            <span>{money2(cardPrice(item.clientTotal))}</span>
          </div>
          {item.supplier && (
            <div>
              <span>Supplier</span>
              <span>{item.supplier}</span>
            </div>
          )}
        </div>

        {item.media && item.media.length > 0 && (
          <div className="media">
            {item.media.map((m, i) =>
              m.type === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video key={i} src={m.url} controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={m.url} alt="From the inspection" />
              ),
            )}
          </div>
        )}
        {item.notes && <div className="why">Notes: {item.notes}</div>}
        <button className="del" onClick={del}>
          Delete line
        </button>
      </div>
    </aside>
  );
}

function Steps({ item }: { item: LineItem }) {
  const estimateName = useEstimateStore((s) => s.estimate.name);
  const key = `${item.id}:${item.name}:${item.quantity}:${item.unit}:${item.unitCost}`;
  const [steps, setSteps] = useState<StepsResult | null>(() => stepCache.get(key) ?? null);

  useEffect(() => {
    const hit = stepCache.get(key);
    if (hit) {
      setSteps(hit);
      return;
    }
    setSteps(null);
    let off = false;
    fetch("/api/steps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item, estimateName }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((d: StepsResult) => {
        const res = { steps: d.steps ?? [], rationale: d.rationale };
        if (!res.steps.length) throw new Error("empty");
        return res;
      })
      .catch(() => deterministicSteps(item))
      .then((res) => {
        stepCache.set(key, res);
        if (!off) setSteps(res);
      });
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>
        How it gets done
      </div>
      {!steps ? (
        <span className="working">
          <span className="spin" />
          Working out the steps
        </span>
      ) : (
        <>
          <ol className="steps">
            {steps.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {steps.rationale && (
            <div className="why" style={{ marginTop: 8 }}>
              {steps.rationale}
            </div>
          )}
        </>
      )}
    </div>
  );
}
