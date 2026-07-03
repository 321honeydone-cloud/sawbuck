"use client";

import { useEffect, useMemo, useState } from "react";
import { rateBook } from "@/lib/loadRateBook";
import {
  applyOverrides,
  isPriced,
  UNIT_OPTIONS,
  type OverrideMap,
  type RateBookCounts,
} from "@/lib/rateOverrides";
import type { RateTask } from "@/lib/rateBook";

const BASE = rateBook.tasks;
const STUB_TOTAL = BASE.filter((t) => !isPriced(t.final_price)).length;
const CATEGORIES = Array.from(new Set(BASE.map((t) => String(t.category ?? "")).filter(Boolean))).sort();
const ROW_CAP = 250;

type StatusFilter = "needs" | "priced" | "edited" | "jobs" | "all";

interface Proposal {
  name: string;
  category: string;
  isNew: boolean;
  final_price: number;
  unit: string;
  labor_minutes: number | null;
  material_allowance: number | null;
  current_price: number | null;
  current_unit: string | null;
  note: string;
}

const input =
  "rounded-md border border-border bg-card-2 px-2 py-1 text-sm text-ink outline-none focus:border-brand/60";
const btnPrimary =
  "rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40";
const btnGhost =
  "rounded-md border border-border bg-card-2 px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-muted transition hover:text-ink disabled:opacity-40";

export default function RateBookManager() {
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [counts, setCounts] = useState<RateBookCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("needs");

  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState("");
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillMsg, setFillMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    fetch("/api/ratebook")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load the rate book."))))
      .then((d) => {
        setOverrides(d.overrides ?? {});
        setCounts(d.counts ?? null);
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  async function autoFill() {
    setFilling(true);
    setFillMsg("");
    try {
      const res = await fetch("/api/cron/ratebook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "fill", limit: 15 }),
      });
      const d = (await res.json().catch(() => ({}))) as { saved?: number; error?: string };
      if (res.ok) {
        setFillMsg(`Filled ${d.saved ?? 0} price${d.saved === 1 ? "" : "s"} from the web. Refreshing.`);
        const r2 = await fetch("/api/ratebook");
        if (r2.ok) {
          const dd = (await r2.json()) as { overrides?: OverrideMap; counts?: RateBookCounts };
          setOverrides(dd.overrides ?? {});
          setCounts(dd.counts ?? null);
        }
      } else {
        setFillMsg(d.error === "forbidden" ? "Admins only." : "Could not auto-fill right now. The cloud brain may be off.");
      }
    } finally {
      setFilling(false);
    }
  }

  const merged = useMemo(() => applyOverrides(BASE, overrides), [overrides]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merged.filter((t) => {
      if (category !== "all" && String(t.category ?? "") !== category) return false;
      const priced = isPriced(t.final_price);
      if (status === "needs" && priced) return false;
      if (status === "priced" && !priced) return false;
      if (status === "edited" && !overrides[t.name]) return false;
      if (status === "jobs" && overrides[t.name]?.source !== "quote") return false;
      if (q) {
        const hay = (t.name + " " + (t.taxonomy_path ?? "") + " " + (t.category ?? "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [merged, search, category, status, overrides]);

  const shown = filtered.slice(0, ROW_CAP);

  function onSaved(name: string, override: OverrideMap[string], c: RateBookCounts) {
    setOverrides((prev) => ({ ...prev, [name]: override }));
    setCounts(c);
  }
  function onReset(name: string, c: RateBookCounts) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setCounts(c);
  }

  async function askAi() {
    const instruction = aiText.trim();
    if (!instruction || aiBusy) return;
    setAiBusy(true);
    setAiReply("");
    setProposals(null);
    try {
      const res = await fetch("/api/ratebook/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      if (res.status === 503) {
        setAiReply("AI is off (no API key). Edit the price in the table below by hand.");
        return;
      }
      if (!res.ok) {
        setAiReply("Could not read that. Try naming the task and price, like: LVP install $3.50 a square foot.");
        return;
      }
      const d = (await res.json()) as { reply?: string; edits?: Proposal[] };
      setAiReply(d.reply ?? "");
      setProposals(d.edits && d.edits.length ? d.edits : []);
    } catch {
      setAiReply("Something went wrong reaching the AI. Edit by hand below.");
    } finally {
      setAiBusy(false);
    }
  }

  async function applyProposals() {
    if (!proposals || proposals.length === 0) {
      setProposals(null);
      return;
    }
    setApplying(true);
    try {
      let lastCounts: RateBookCounts | null = null;
      const nextOverrides: OverrideMap = { ...overrides };
      for (const p of proposals) {
        const res = await fetch("/api/ratebook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: p.name,
            category: p.category,
            final_price: p.final_price,
            unit: p.unit,
            labor_minutes: p.labor_minutes,
            material_allowance: p.material_allowance,
          }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.override) nextOverrides[p.name] = d.override;
          if (d.counts) lastCounts = d.counts;
        }
      }
      setOverrides(nextOverrides);
      if (lastCounts) setCounts(lastCounts);
      setProposals(null);
      setAiText("");
      setAiReply("");
    } finally {
      setApplying(false);
    }
  }

  const stubsPriced = counts ? STUB_TOTAL - counts.stubs : 0;
  const pct = STUB_TOTAL ? Math.round((stubsPriced / STUB_TOTAL) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Progress + AI command bar */}
      <div className="space-y-3 border-b border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted">Progress</span>
          {counts ? (
            <>
              <span className="text-ink">
                <span className="font-display text-lg text-gold">{stubsPriced}</span>
                <span className="text-muted"> of {STUB_TOTAL} stubs priced</span>
              </span>
              <span className="text-muted">
                Total priced {counts.priced} / {counts.total}
              </span>
              <span className="text-muted">Your edits {counts.overridden}</span>
            </>
          ) : (
            <span className="text-muted">{loading ? "Loading..." : "—"}</span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: pct + "%" }} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askAi()}
            placeholder='Tell AI a price, like: LVP flooring installation costs $3.50 a square foot'
            className={input + " flex-1 py-2"}
          />
          <button onClick={askAi} disabled={aiBusy || !aiText.trim()} className={btnPrimary}>
            {aiBusy ? "Reading..." : "Ask AI to price"}
          </button>
          <button onClick={autoFill} disabled={filling} className={btnGhost} title="Research 15 unpriced tasks on the web and fill them">
            {filling ? "Filling..." : "Auto-fill 15 from web"}
          </button>
        </div>
        {aiReply && !proposals && <p className="text-xs text-muted">{aiReply}</p>}
        {fillMsg && <p className="text-xs text-brand">{fillMsg}</p>}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/60 px-5 py-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks"
          className={input + " w-48"}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
          <option value="all">All trades</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-md border border-border">
          {(["needs", "priced", "edited", "jobs", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                "px-3 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.06em] transition " +
                (status === s ? "bg-brand text-black" : "bg-card-2 text-muted hover:text-ink")
              }
            >
              {s === "needs" ? "Needs price" : s === "jobs" ? "From jobs" : s}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(true)} className={btnPrimary}>
          + Add task
        </button>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {filtered.length} {filtered.length === 1 ? "task" : "tasks"}
          {filtered.length > ROW_CAP ? ` (showing ${ROW_CAP})` : ""}
        </span>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {err && <p className="px-5 py-4 text-sm text-flag">{err}</p>}
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            <tr className="border-b border-border">
              <th className="px-5 py-2 font-medium">Task</th>
              <th className="px-2 py-2 font-medium">Price $</th>
              <th className="px-2 py-2 font-medium">Unit</th>
              <th className="px-2 py-2 font-medium">Labor min</th>
              <th className="px-2 py-2 font-medium">Material $</th>
              <th className="px-2 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <RateRow
                key={t.name}
                task={t}
                overridden={!!overrides[t.name]}
                source={overrides[t.name]?.source}
                onSaved={onSaved}
                onReset={onReset}
              />
            ))}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-muted">
                  No tasks match. Try a different trade or clear the search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddTaskModal merged={merged} onSaved={onSaved} onClose={() => setShowAdd(false)} />}

      {/* AI proposal confirm modal */}
      {proposals && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-ink">
              {proposals.length ? "Confirm price" : "Nothing to apply"}
            </h2>
            {aiReply && <p className="mt-1 text-sm text-muted">{aiReply}</p>}
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {proposals.map((p, i) => (
                <div key={i} className="rounded-md border border-border bg-card-2 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{p.name}</span>
                    {p.isNew && (
                      <span className="rounded bg-brand/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-gold">
                        new
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    {p.current_price != null ? `$${p.current_price} ${p.current_unit ?? ""} ` : "unpriced "}
                    <span className="text-gold">→ ${p.final_price} {p.unit}</span>
                  </div>
                  {p.note && <p className="mt-1 text-xs text-muted">{p.note}</p>}
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setProposals(null)} disabled={applying} className={btnGhost}>
                Cancel
              </button>
              {proposals.length > 0 && (
                <button onClick={applyProposals} disabled={applying} className={btnPrimary}>
                  {applying ? "Saving..." : proposals.length === 1 ? "Apply price" : `Apply ${proposals.length} prices`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- Add-a-task modal -----
// Uniform task entry: category, item, and action come from dropdowns fed by
// what is already in the book, so new names follow the same "Item, Action"
// convention the matcher and the estimator rely on. Every dropdown has a
// "Type my own..." escape hatch for anything the book has never seen.

const CUSTOM = "__custom__";

/** Canonical action verbs used across the book, most common first. */
const ACTIONS = [
  "Repair",
  "Replace",
  "Install New",
  "Replace/Install",
  "Remove/Install",
  "Remove",
  "Clean",
  "Unclog",
  "Seal/Caulk",
  "Adjust",
  "Service",
  "Haul Off",
];

function ComboField({
  label,
  options,
  pick,
  custom,
  setPick,
  setCustom,
  customPlaceholder,
}: {
  label: string;
  options: string[];
  pick: string;
  custom: string;
  setPick: (v: string) => void;
  setCustom: (v: string) => void;
  customPlaceholder?: string;
}) {
  const isCustom = pick === CUSTOM;
  return (
    <div>
      <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">{label}</label>
      {!isCustom ? (
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={input + " mt-1 block w-full"}>
          <option value="">Pick...</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={CUSTOM}>Type my own...</option>
        </select>
      ) : (
        <div className="mt-1 flex gap-1.5">
          <input
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={customPlaceholder}
            className={input + " w-full"}
          />
          <button
            type="button"
            onClick={() => {
              setPick("");
              setCustom("");
            }}
            className={btnGhost + " shrink-0 px-2"}
            title="Back to the list"
          >
            List
          </button>
        </div>
      )}
    </div>
  );
}

function AddTaskModal({
  merged,
  onSaved,
  onClose,
}: {
  merged: RateTask[];
  onSaved: (name: string, override: OverrideMap[string], c: RateBookCounts) => void;
  onClose: () => void;
}) {
  const [catPick, setCatPick] = useState("");
  const [catCustom, setCatCustom] = useState("");
  const [itemPick, setItemPick] = useState("");
  const [itemCustom, setItemCustom] = useState("");
  const [actionPick, setActionPick] = useState("");
  const [actionCustom, setActionCustom] = useState("");
  const [detail, setDetail] = useState("");
  const [unitPick, setUnitPick] = useState("each");
  const [unitCustom, setUnitCustom] = useState("");
  const [price, setPrice] = useState("");
  const [labor, setLabor] = useState("");
  const [material, setMaterial] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const category = (catPick === CUSTOM ? catCustom : catPick).trim();
  const item = (itemPick === CUSTOM ? itemCustom : itemPick).trim();
  const action = (actionPick === CUSTOM ? actionCustom : actionPick).trim();
  const unit = (unitPick === CUSTOM ? unitCustom : unitPick).trim() || "each";

  // Items (fixtures/areas) already used in this trade, from the "Item, Action"
  // naming convention: everything before the last comma of each task name.
  const itemOptions = useMemo(() => {
    const src = merged.filter((t) => !category || String(t.category ?? "") === category);
    const set = new Set<string>();
    for (const t of src) {
      const i = t.name.lastIndexOf(",");
      if (i > 0) set.add(t.name.slice(0, i).trim());
    }
    return [...set].sort();
  }, [merged, category]);

  const tail = [action, detail.trim()].filter(Boolean).join(" ");
  const name = [item, tail].filter(Boolean).join(", ");
  const dupe = !!name && merged.some((t) => t.name.trim().toLowerCase() === name.toLowerCase());
  const priceNum = Number(price);
  const canSave = !!category && !!name && isFinite(priceNum) && priceNum > 0 && !dupe && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setSavedMsg("");
    try {
      const res = await fetch("/api/ratebook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          final_price: priceNum,
          unit,
          labor_minutes: labor === "" ? null : Number(labor),
          material_allowance: material === "" ? null : Number(material),
        }),
      });
      if (res.ok) {
        const d = await res.json();
        onSaved(name, d.override, d.counts);
        setSavedMsg(`Added ${name} at $${priceNum} ${unit} at ${new Date().toLocaleTimeString()} ✓`);
        // Keep category and unit for fast batch entry; clear the rest.
        setItemPick("");
        setItemCustom("");
        setActionPick("");
        setActionCustom("");
        setDetail("");
        setPrice("");
        setLabor("");
        setMaterial("");
      } else {
        setSavedMsg("Could not save. Check the fields and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-ink">Add a rate book task</h2>
        <p className="mt-1 text-xs text-muted">
          Pick from the lists to keep names uniform with the rest of the book. Any list has a &quot;Type my own&quot;
          option when the book doesn&apos;t have what you need.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ComboField
            label="Trade"
            options={CATEGORIES}
            pick={catPick}
            custom={catCustom}
            setPick={setCatPick}
            setCustom={setCatCustom}
            customPlaceholder="e.g. Pool & Screen"
          />
          <ComboField
            label="Item / area"
            options={itemOptions}
            pick={itemPick}
            custom={itemCustom}
            setPick={setItemPick}
            setCustom={setItemCustom}
            customPlaceholder="e.g. Sink, Kitchen"
          />
          <ComboField
            label="Action"
            options={ACTIONS}
            pick={actionPick}
            custom={actionCustom}
            setPick={setActionPick}
            setCustom={setActionCustom}
            customPlaceholder="e.g. Rebuild"
          />
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Detail (optional)</label>
            <input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="e.g. Faucet, Garbage Disposal"
              className={input + " mt-1 block w-full"}
            />
          </div>
          <ComboField
            label="Unit"
            options={[...UNIT_OPTIONS]}
            pick={unitPick}
            custom={unitCustom}
            setPick={setUnitPick}
            setCustom={setUnitCustom}
            customPlaceholder="e.g. per panel"
          />
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Price $ (required)</label>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 115"
              className={input + " mt-1 block w-full"}
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Labor min (optional)</label>
            <input
              inputMode="numeric"
              value={labor}
              onChange={(e) => setLabor(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="—"
              className={input + " mt-1 block w-full"}
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">Material $ (optional)</label>
            <input
              inputMode="decimal"
              value={material}
              onChange={(e) => setMaterial(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="—"
              className={input + " mt-1 block w-full"}
            />
          </div>
        </div>

        <div className="mt-4 rounded-md border border-border bg-card-2 p-3 text-sm">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Will be saved as</span>
          <div className="mt-1 text-ink">
            <span className="font-medium">{name || "—"}</span>
            {name && (
              <span className="ml-2 text-muted">
                · {category || "no trade"} · {price ? `$${price}` : "no price"} {unit}
              </span>
            )}
          </div>
        </div>

        {dupe && (
          <p className="mt-2 text-xs text-amber-400">
            That task is already in the book. Search for it in the table and edit its price there instead.
          </p>
        )}
        {savedMsg && <p className="mt-2 text-sm font-medium text-emerald-400">{savedMsg}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={btnGhost}>
            Done
          </button>
          <button onClick={save} disabled={!canSave} className={btnPrimary}>
            {busy ? "Saving..." : "Add to rate book"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RateRow({
  task,
  overridden,
  source,
  onSaved,
  onReset,
}: {
  task: RateTask;
  overridden: boolean;
  source?: string;
  onSaved: (name: string, override: OverrideMap[string], c: RateBookCounts) => void;
  onReset: (name: string, c: RateBookCounts) => void;
}) {
  const numStr = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const [price, setPrice] = useState(numStr(isPriced(task.final_price) ? task.final_price : ""));
  const [unit, setUnit] = useState(String(task.unit ?? "each"));
  const [labor, setLabor] = useState(numStr(task.labor_minutes));
  const [material, setMaterial] = useState(numStr(task.material_allowance));
  const [busy, setBusy] = useState(false);

  // Re-sync local draft when the underlying task changes (after a save/reset).
  useEffect(() => {
    setPrice(numStr(isPriced(task.final_price) ? task.final_price : ""));
    setUnit(String(task.unit ?? "each"));
    setLabor(numStr(task.labor_minutes));
    setMaterial(numStr(task.material_allowance));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.final_price, task.unit, task.labor_minutes, task.material_allowance]);

  const priced = isPriced(task.final_price);
  const dirty =
    price !== numStr(isPriced(task.final_price) ? task.final_price : "") ||
    unit !== String(task.unit ?? "each") ||
    labor !== numStr(task.labor_minutes) ||
    material !== numStr(task.material_allowance);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ratebook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: task.name,
          category: task.category,
          taxonomy_path: task.taxonomy_path,
          final_price: price === "" ? null : Number(price),
          unit,
          labor_minutes: labor === "" ? null : Number(labor),
          material_allowance: material === "" ? null : Number(material),
        }),
      });
      if (res.ok) {
        const d = await res.json();
        onSaved(task.name, d.override, d.counts);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ratebook", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: task.name }),
      });
      if (res.ok) {
        const d = await res.json();
        onReset(task.name, d.counts);
      }
    } finally {
      setBusy(false);
    }
  }

  const cell = "rounded border border-border bg-card-2 px-2 py-1 text-sm text-ink outline-none focus:border-brand/60";

  return (
    <tr className="border-b border-border/60 align-top hover:bg-card-2/40">
      <td className="px-5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-ink">{task.name}</span>
          {!priced && (
            <span className="rounded bg-flag/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-flag">
              stub
            </span>
          )}
          {overridden && (
            <span
              className={
                "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide " +
                (source === "quote" ? "bg-gain/20 text-gain" : "bg-brand/20 text-gold")
              }
            >
              {source === "quote" ? "from job" : "edited"}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted">{String(task.category ?? "")}</div>
      </td>
      <td className="px-2 py-2">
        <input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="—"
          className={cell + " w-20"}
        />
      </td>
      <td className="px-2 py-2">
        <select value={unit} onChange={(e) => setUnit(e.target.value)} className={cell + " w-32"}>
          {!UNIT_OPTIONS.includes(unit as (typeof UNIT_OPTIONS)[number]) && <option value={unit}>{unit}</option>}
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          inputMode="numeric"
          value={labor}
          onChange={(e) => setLabor(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="—"
          className={cell + " w-16"}
        />
      </td>
      <td className="px-2 py-2">
        <input
          inputMode="decimal"
          value={material}
          onChange={(e) => setMaterial(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="—"
          className={cell + " w-16"}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={save}
            disabled={!dirty || busy}
            className="rounded-md bg-brand px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-30"
          >
            Save
          </button>
          {overridden && (
            <button
              onClick={reset}
              disabled={busy}
              className="rounded-md border border-border px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-muted transition hover:text-ink disabled:opacity-30"
              title="Revert to the base book value"
            >
              Reset
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
