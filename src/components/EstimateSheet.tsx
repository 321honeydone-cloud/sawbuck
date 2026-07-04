"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import JobberModal from "./JobberModal";
import { money, pct } from "@/lib/format";
import { cardPrice, HONEYDONE } from "@/lib/honeydone";
import { computeTotals } from "@/lib/totals";
import { splitBuilds, type BuildSplit } from "@/lib/builds";
import { deterministicSteps, type StepsResult } from "@/lib/steps";
import type { Group, LineItem, Totals, Unit } from "@/lib/types";

// Friendly labels for the unit dropdown. Value is the stored Unit enum, label is
// the plain-English text shown on the sheet (no cryptic LS / SF / CY).
const UNIT_CHOICES: { value: Unit; label: string }[] = [
  { value: "EA", label: "Each" },
  { value: "HRS", label: "Hours" },
  { value: "SF", label: "Sq ft" },
  { value: "LF", label: "Linear ft" },
  { value: "SY", label: "Sq yard" },
  { value: "CY", label: "Cubic yard" },
  { value: "LS", label: "NA" },
  { value: "DAY", label: "Day" },
];

// Per-line work steps, cached for the session so expanding a line re-fetches
// only when the line's scope actually changes.
const stepCache = new Map<string, StepsResult>();

type CheckState = "on" | "off" | "some";

// Shared column grid so the line-item header and every row line up the same:
// Qty, Unit, Unit cost, Markup, Total. Right-aligned numeric columns read clean.
const SHEET_COLS = "grid grid-cols-[1.15rem_2.6rem_minmax(0,1fr)_3.6rem_4.2rem_4.6rem_4.6rem] gap-x-2";

export default function EstimateSheet() {
  const estimate = useEstimateStore((s) => s.estimate);
  const [jobberOpen, setJobberOpen] = useState(false);
  // Excluded LINE ITEM ids. Unchecked lines drop out of the total and the
  // Jobber quote but stay visible, greyed. Sections roll up their lines.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => setExcluded(new Set()), [estimate.id]);

  const allItemIds = estimate.groups.flatMap((g) => g.items.map((i) => i.id));
  const includedGroups = estimate.groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => !excluded.has(i.id)),
  }));
  const liveTotals = computeTotals(includedGroups);
  // Split the included sheet into the Smooth Scenario and Max Price Guarantee so
  // the header can always lead with the Max (red) and show the cap buffer (yellow).
  const split = splitBuilds({ ...estimate, groups: includedGroups });

  const offCount = allItemIds.filter((id) => excluded.has(id)).length;
  const masterState: CheckState =
    offCount === 0 ? "on" : offCount === allItemIds.length ? "off" : "some";

  const toggleItem = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (group: Group) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      const allIn = group.items.every((i) => !next.has(i.id));
      for (const i of group.items) {
        if (allIn) next.add(i.id); // all on → turn the section off
        else next.delete(i.id); // otherwise → turn the whole section on
      }
      return next;
    });

  const toggleAll = () => setExcluded((prev) => (prev.size === 0 ? new Set(allItemIds) : new Set()));

  const hasGroups = estimate.groups.length > 0;

  return (
    <div className="flex min-h-full flex-col">
      {/* One sticky shell for both bars. They used to be sticky separately with
          a hard-coded top-16 on the review bar, which only lined up while the
          totals bar was exactly 64px tall — on phones it now wraps taller. */}
      <div className="sticky top-0 z-10 bg-bg">
        <TotalsBar totals={liveTotals} split={split} onJobber={() => setJobberOpen(true)} />
        <ReviewBar />
      </div>
      <JobberModal open={jobberOpen} onClose={() => setJobberOpen(false)} excluded={excluded} />
      <div className="flex-1 px-5 py-4">
        {!hasGroups ? (
          <div className="grid h-full place-items-center py-24 text-center text-muted">
            <div>
              <p className="text-ink">No line items yet.</p>
              <p className="mt-1 text-sm">Describe a job in the chat and the estimate will build here.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <Check state={masterState} onChange={toggleAll} />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                All line items{offCount > 0 ? ` · ${offCount} off` : ""}
              </span>
            </div>
            <div className="space-y-6">
              {estimate.groups
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((g) => (
                  <GroupTable
                    key={g.id}
                    group={g}
                    excluded={excluded}
                    onToggleItem={toggleItem}
                    onToggleGroup={() => toggleGroup(g)}
                  />
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Square industrial checkbox. Gold check when on, gold dash when partial. */
function Check({ state, onChange }: { state: CheckState; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "on" ? true : state === "off" ? false : "mixed"}
      onClick={onChange}
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[11px] font-bold leading-none transition ${
        state === "off" ? "border-border bg-card-2 text-transparent" : "border-brand bg-brand text-black"
      }`}
    >
      {state === "some" ? "–" : "✓"}
    </button>
  );
}

function TotalsBar({ totals, split, onJobber }: { totals: Totals; split: BuildSplit; onJobber: () => void }) {
  const hasItems = useEstimateStore((s) => s.estimate.groups.some((g) => g.items.length > 0));
  // Always lead the header with the Max Price Guarantee (red). When there is a
  // Complications Cap, also show the Smooth expected price and the cap buffer
  // (yellow) so the ceiling and the honest expected number are both visible.
  const metrics: { key: string; label: string; value: string; tone: string; big?: boolean }[] = [
    { key: "cost", label: "Job cost", value: money(totals.totalCost), tone: "text-ink" },
    ...(split.hasCap
      ? [
          { key: "smooth", label: "Smooth (expected)", value: money(split.smoothCash), tone: "text-gain" },
          { key: "cap", label: "Complications cap", value: "+" + money(split.capCash), tone: "text-yellow" },
        ]
      : []),
    { key: "max", label: "Max Price Guarantee", value: money(split.maxCash), tone: "text-danger", big: true },
    { key: "card", label: `Card price +${HONEYDONE.cardSurchargePct}%`, value: money(cardPrice(split.maxCash)), tone: "text-muted" },
  ];
  return (
    // Phones get a wrap-friendly grid so every number is visible at once — the
    // old fixed h-16 strip forced a horizontal scroll that clipped the prices.
    // md and up keeps the original one-row layout.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-bg px-4 py-2.5 backdrop-blur md:h-16 md:flex-nowrap md:px-5 md:py-0">
      <div
        className="grid w-full min-w-0 grid-cols-2 gap-x-4 gap-y-2 md:flex md:w-auto md:flex-1 md:items-center md:gap-6 md:overflow-x-auto md:overflow-y-hidden"
        aria-label="Estimate totals"
      >
        {metrics.map((m) => (
          <div key={m.key} className="min-w-0 md:shrink-0">
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-muted md:whitespace-nowrap">
              {m.label}
            </div>
            <div
              className={`mt-0.5 whitespace-nowrap font-display font-semibold leading-none tabular-nums ${m.tone} ${
                m.big
                  ? "text-2xl md:text-3xl" // the Max Price Guarantee is THE number; give it top billing
                  : m.key === "cost"
                    ? "text-base md:text-lg" // internal cost reads quieter than client-facing prices
                    : "text-lg md:text-xl"
              }`}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>
      {split.maxCash >= HONEYDONE.handymanCapUsd && (
        <span
          className="w-full rounded-md border border-danger/60 bg-danger/10 px-2.5 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-danger md:w-auto"
          title="Florida Statute 489.103(9): the handyman exemption only covers jobs under $2,500 total. Do not split it into smaller invoices — refer it to a licensed contractor."
        >
          Over ${HONEYDONE.handymanCapUsd.toLocaleString()} — refer out
        </span>
      )}
      <button
        onClick={onJobber}
        disabled={!hasItems}
        className="w-full shrink-0 rounded-md border border-brand/60 bg-brand/10 px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.06em] text-brand transition hover:bg-brand/20 disabled:opacity-40 md:w-auto"
      >
        Finalize
      </button>
    </div>
  );
}

function ReviewBar() {
  const pending = useEstimateStore((s) => s.pendingChanges);
  const accept = useEstimateStore((s) => s.acceptChanges);
  const reject = useEstimateStore((s) => s.rejectChanges);
  if (!pending || pending.length === 0) return null;

  return (
    <div className="border-b border-flag/40 bg-flag/10 px-5 py-2.5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-flag">
          <span className="font-semibold">{pending.length}</span> AI {pending.length === 1 ? "change" : "changes"} to review
        </div>
        <div className="flex gap-2">
          <button
            onClick={reject}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-ink transition hover:bg-card"
          >
            Reject
          </button>
          <button
            onClick={accept}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-black transition hover:bg-brand-dim"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupTable({
  group,
  excluded,
  onToggleItem,
  onToggleGroup,
}: {
  group: Group;
  excluded: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleGroup: () => void;
}) {
  const included = group.items.filter((i) => !excluded.has(i.id));
  const noneIn = included.length === 0;
  const allIn = included.length === group.items.length;
  const state: CheckState = noneIn ? "off" : allIn ? "on" : "some";
  const subtotal = included.reduce((s, i) => s + i.clientTotal, 0);

  return (
    <div
      className={`overflow-hidden rounded-xl border border-l-2 bg-card ${
        noneIn ? "border-border/60 border-l-border" : "border-border border-l-gold/70"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Check state={state} onChange={onToggleGroup} />
          <h3
            className={`min-w-0 truncate font-display text-sm font-semibold uppercase tracking-[0.06em] ${
              noneIn ? "text-muted line-through" : ""
            }`}
          >
            <span className={noneIn ? "text-muted" : "text-gold"}>{group.position}.</span> {group.name}
          </h3>
          <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted sm:inline">
            {included.length}/{group.items.length} {group.items.length === 1 ? "line" : "lines"}
          </span>
        </div>
        <div className="shrink-0 text-sm text-muted">
          {noneIn ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">not in total</span>
          ) : (
            <>
              Subtotal <span className="font-semibold text-ink">{money(subtotal)}</span>
            </>
          )}
        </div>
      </div>
      <div className={`${SHEET_COLS} hidden border-b border-border/60 bg-card-2/30 px-3 pb-1.5 pt-1.5 sm:grid`}>
        <span></span>
        <span></span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Item</span>
        <span className="text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Qty</span>
        <span className="text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Unit</span>
        <span className="text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Unit cost</span>
        <span className="text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Total</span>
      </div>
      <div className="divide-y divide-border/60">
        {group.items
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((item) => (
            <Row
              key={item.id}
              item={item}
              groupPos={group.position}
              included={!excluded.has(item.id)}
              onToggle={() => onToggleItem(item.id)}
            />
          ))}
      </div>
    </div>
  );
}

function Row({
  item,
  groupPos,
  included,
  onToggle,
}: {
  item: LineItem;
  groupPos: number;
  included: boolean;
  onToggle: () => void;
}) {
  const edit = useEstimateStore((s) => s.editLineItem);
  const highlighted = useEstimateStore((s) => s.highlightIds.has(item.id));
  const [open, setOpen] = useState(false);
  const dim = included ? "" : "opacity-45";

  return (
    <div className={`${open ? "bg-card-2/40" : ""} ${highlighted ? "ai-flash" : ""}`}>
      {/* Desktop: one true table row. The description wraps inside its column. */}
      <div className={`${SHEET_COLS} hidden items-start px-3 py-2.5 sm:grid ${dim}`}>
        <Check state={included ? "on" : "off"} onChange={onToggle} />
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide cost breakdown" : "Show cost breakdown"}
          className="flex shrink-0 items-center gap-1 font-mono text-xs text-muted transition hover:text-ink"
        >
          <span className={`inline-block text-[9px] transition-transform ${open ? "rotate-90 text-gold" : ""}`}>▶</span>
          <span>{groupPos}.{item.position}</span>
        </button>
        <div className="min-w-0">
          <DescriptionCell value={item.name} supplier={item.supplier} onCommit={(v) => edit(item.id, "name", v)} />
        </div>
        <EditableNumber value={item.quantity} onCommit={(v) => edit(item.id, "quantity", v)} />
        <select
          value={item.unit}
          onChange={(e) => edit(item.id, "unit", e.target.value)}
          aria-label="Unit"
          className="w-full min-w-0 cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-sm text-muted outline-none transition hover:border-border hover:text-ink focus:border-brand/60"
        >
          {UNIT_CHOICES.map((u) => (
            <option key={u.value} value={u.value} className="bg-card text-ink">{u.label}</option>
          ))}
        </select>
        <EditableNumber value={item.unitCost} prefix="$" onCommit={(v) => edit(item.id, "unitCost", v)} />
        <span className="self-center text-right font-semibold tabular-nums text-brand">{money(item.clientTotal)}</span>
      </div>

      {/* Mobile: description on its own line, numbers labeled underneath. */}
      <div className={`px-3 py-2.5 sm:hidden ${dim}`}>
        <div className="flex items-start gap-2">
          <Check state={included ? "on" : "off"} onChange={onToggle} />
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Hide cost breakdown" : "Show cost breakdown"}
            className="mt-0.5 flex shrink-0 items-center gap-1 font-mono text-xs text-muted transition hover:text-ink"
          >
            <span className={`inline-block text-[9px] transition-transform ${open ? "rotate-90 text-gold" : ""}`}>▶</span>
            <span>{groupPos}.{item.position}</span>
          </button>
          <div className="min-w-0 flex-1">
            <DescriptionCell value={item.name} supplier={item.supplier} onCommit={(v) => edit(item.id, "name", v)} />
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-x-2 pl-[1.9rem]">
          <label className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Qty</span>
            <EditableNumber value={item.quantity} onCommit={(v) => edit(item.id, "quantity", v)} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Unit</span>
            <select
              value={item.unit}
              onChange={(e) => edit(item.id, "unit", e.target.value)}
              aria-label="Unit"
              className="w-full min-w-0 cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-sm text-muted outline-none transition hover:border-border hover:text-ink focus:border-brand/60"
            >
              {UNIT_CHOICES.map((u) => (
                <option key={u.value} value={u.value} className="bg-card text-ink">{u.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Unit $</span>
            <EditableNumber value={item.unitCost} prefix="$" onCommit={(v) => edit(item.id, "unitCost", v)} />
          </label>
          <div className="flex flex-col gap-0.5">
            <span className="text-right font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Total</span>
            <span className="text-right font-semibold tabular-nums text-brand">{money(item.clientTotal)}</span>
          </div>
        </div>
      </div>

      {open && (
        <div className="bg-card-2/30 px-3 pb-3 pl-[2.6rem]">
          <BreakdownCard item={item} />
        </div>
      )}
    </div>
  );
}

/**
 * Expanded line detail. Internal only. Leads with the work steps so Manny can
 * see how the line was reasoned, then lays the cost math bare underneath. Steps
 * come from /api/steps (Claude, with an offline fallback) and are cached.
 */
function BreakdownCard({ item }: { item: LineItem }) {
  const estimateName = useEstimateStore((s) => s.estimate.name);
  const edit = useEstimateStore((s) => s.editLineItem);
  const cacheKey = `${item.id}:${item.name}:${item.quantity}:${item.unit}:${item.unitCost}`;
  const [steps, setSteps] = useState<StepsResult | null>(() => stepCache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cached = stepCache.get(cacheKey);
    if (cached) {
      setSteps(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/steps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item, estimateName }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad response"))))
      .then((d: StepsResult) => {
        const res: StepsResult = { steps: d.steps ?? [], rationale: d.rationale };
        if (!res.steps.length) throw new Error("empty");
        stepCache.set(cacheKey, res);
        if (!cancelled) setSteps(res);
      })
      .catch(() => {
        const res = deterministicSteps(item);
        stepCache.set(cacheKey, res);
        if (!cancelled) setSteps(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, estimateName, item]);

  const lineCard = cardPrice(item.clientTotal);
  const margin = item.clientTotal > 0 ? (item.markupAmount / item.clientTotal) * 100 : 0;
  const cell = (label: string, value: string, accent?: boolean) => (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`mt-0.5 tabular-nums ${accent ? "font-semibold text-brand" : "text-ink"}`}>{value}</div>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
        How it gets done · for your eyes only
      </div>
      {loading && !steps && <p className="text-xs text-muted">Working out the steps…</p>}
      {steps && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink marker:font-semibold marker:text-gold">
            {steps.steps.map((st, i) => (
              <li key={i}>{st}</li>
            ))}
          </ol>
          {steps.rationale && (
            <p className="mt-2 text-xs italic text-muted">Why this size: {steps.rationale}</p>
          )}
        </>
      )}

      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Cost breakdown</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {cell("Quantity", `${item.quantity} ${item.unit}`)}
          {cell("Unit cost", money(item.unitCost))}
          {cell("Cost type", item.costType)}
          {cell("Supplier", item.supplier ?? "—")}
          {cell("Builder cost", money(item.builderCost))}
          {cell(`Markup ${pct(item.markupPct)}`, money(item.markupAmount))}
          {cell("Client total", money(item.clientTotal), true)}
          {cell("Card price +3%", money(lineCard))}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Markup</span>
          <EditableNumber value={item.markupPct} suffix="%" onCommit={(v) => edit(item.id, "markupPct", v)} />
          <span className="text-xs text-muted">adds {money(item.markupAmount)}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 font-mono text-xs text-muted">
          <span className="text-ink">
            {item.quantity} {item.unit}
          </span>
          <span>×</span>
          <span className="text-ink">{money(item.unitCost)}</span>
          <span>=</span>
          <span className="text-ink">{money(item.builderCost)} cost</span>
          <span className="text-gold">+</span>
          <span className="text-ink">
            {pct(item.markupPct)} markup ({money(item.markupAmount)})
          </span>
          <span className="text-gold">=</span>
          <span className="font-semibold text-brand">{money(item.clientTotal)} client</span>
          <span>·</span>
          <span className="text-ink">{money(lineCard)} card</span>
          <span>·</span>
          <span>{pct(margin)} line margin</span>
        </div>
        {item.media && item.media.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {item.media.map((m, i) =>
              m.type === "video" ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video key={i} src={m.url} controls className="h-20 w-28 rounded-lg border border-border object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={m.url} alt="from inspection" className="h-20 w-20 rounded-lg border border-border object-cover" />
              )
            )}
          </div>
        )}
        {item.notes && <div className="mt-2 text-xs text-muted">Notes: {item.notes}</div>}
      </div>
    </div>
  );
}

/**
 * Description cell. In the stacked row it owns a full-width line, so it wraps
 * freely and is never truncated. Click anywhere on it to edit inline in an
 * autosizing textarea; Enter commits, Escape cancels.
 */
function DescriptionCell({
  value,
  supplier,
  onCommit,
}: {
  value: string;
  supplier: string | null;
  onCommit: (v: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);

  const autosize = (ta: HTMLTextAreaElement) => {
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  };

  useLayoutEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      autosize(ta);
    }
  }, [editing]);

  const commit = (v: string) => {
    setEditing(false);
    if (v !== value) onCommit(v);
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        defaultValue={value}
        rows={1}
        onInput={(e) => autosize(e.currentTarget)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className="w-full resize-none rounded bg-card-2 px-1.5 py-1 text-sm leading-snug text-ink outline-none ring-1 ring-brand/50"
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="cursor-text rounded px-1 py-0.5 leading-snug text-ink hover:bg-card-2"
    >
      <span className="break-words font-medium">{value}</span>
      {supplier && <span className="ml-2 align-middle text-xs text-muted">· {supplier}</span>}
    </div>
  );
}

function EditableNumber({
  value,
  onCommit,
  prefix,
  suffix,
}: {
  value: number;
  onCommit: (v: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <span className="inline-flex items-center justify-end">
      {prefix && <span className="text-muted">{prefix}</span>}
      <input
        type="number"
        defaultValue={value}
        key={value}
        onBlur={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-14 rounded bg-transparent px-1 py-0.5 text-right text-ink outline-none [appearance:textfield] hover:bg-card-2 focus:bg-card-2 focus:ring-1 focus:ring-brand/50 [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="text-muted">{suffix}</span>}
    </span>
  );
}
