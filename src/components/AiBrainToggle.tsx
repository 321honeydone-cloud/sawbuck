"use client";

// Owner-only switch for the live AI brain and local model. Claude runs
// everywhere (cloud API). Local (Ollama) only works when this server can reach
// your Ollama box (over Tailscale on the cloud deploy, or localhost when you
// run the app yourself).
//
// The dropdowns are STAGED: nothing changes until you hit SAVE. After a save
// the panel shows the exact time the switch landed (stored in the database, so
// it survives reloads) and which brain is actually answering, so there is no
// guessing whether the change took.
import { useEffect, useState } from "react";

type State = {
  provider: "claude" | "ollama";
  localReachable: boolean;
  localUrl: string;
  hasCloudKey: boolean;
  localModel: string;
  localModels: { name: string; installed: boolean }[];
  switchedAt: string | null;
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString() : d.toLocaleString();
}

export default function AiBrainToggle() {
  const [s, setS] = useState<State | null>(null);
  // Staged picks; applied only on SAVE.
  const [provider, setProvider] = useState<"claude" | "ollama">("claude");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSwitched, setJustSwitched] = useState(false);

  function sync(next: State) {
    setS(next);
    setProvider(next.provider);
    setModel(next.localModel);
  }

  async function load() {
    const r = await fetch("/api/settings/ai-provider", { cache: "no-store" });
    if (r.ok) sync(await r.json());
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function saveNow() {
    setBusy(true);
    setJustSwitched(false);
    try {
      const r = await fetch("/api/settings/ai-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, ...(model ? { localModel: model } : {}) }),
      });
      if (r.ok) {
        sync(await r.json());
        setJustSwitched(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;

  const dirty = provider !== s.provider || (model !== "" && model !== s.localModel);

  // What will actually answer requests right now (per the SAVED state).
  const effective: "claude" | "ollama" =
    s.provider === "ollama" ? (s.localReachable ? "ollama" : "claude") : "claude";
  const fellBack = s.provider === "ollama" && !s.localReachable;
  const pickedNotPulled =
    s.provider === "ollama" && s.localReachable && s.localModels?.some((m) => m.name === s.localModel && !m.installed);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ai-brain" className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
            AI brain
          </label>
          <select
            id="ai-brain"
            value={provider}
            disabled={busy}
            onChange={(e) => setProvider(e.target.value as "claude" | "ollama")}
            className="mt-1 block rounded-md border border-border bg-bg px-2 py-1 text-sm text-ink disabled:opacity-60"
          >
            <option value="claude">Claude (cloud)</option>
            <option value="ollama">Local (Ollama)</option>
          </select>
        </div>

        {provider === "ollama" && (s.localModels?.length ?? 0) > 0 && (
          <div>
            <label htmlFor="local-model" className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
              Local model
            </label>
            <select
              id="local-model"
              value={model}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-bg px-2 py-1 text-sm text-ink disabled:opacity-60"
            >
              {s.localModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {s.localReachable && !m.installed ? " (not pulled)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={saveNow}
          disabled={busy || !dirty}
          className="rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
        >
          {busy ? "Switching..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => load()}
          disabled={busy}
          className="rounded-md border border-border px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-ink disabled:opacity-60"
        >
          Recheck
        </button>
      </div>

      {justSwitched && !busy && s.switchedAt && (
        <p className="mt-2 text-sm font-medium text-emerald-400">
          Switched to {s.provider === "ollama" ? `Local · ${s.localModel}` : "Claude (cloud)"} at {fmtTime(s.switchedAt)} ✓
        </p>
      )}

      <p className="mt-2 text-sm text-ink">
        Running on:{" "}
        <span className={effective === "ollama" ? "font-semibold text-emerald-400" : "font-semibold text-gold"}>
          {effective === "ollama" ? `Local (Ollama) · ${s.localModel}` : "Claude (cloud)"}
        </span>
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          local:{" "}
          <span className={s.localReachable ? "text-emerald-400" : "text-muted"}>
            {s.localReachable ? "reachable" : "offline here"}
          </span>
        </span>
        {s.switchedAt && (
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            last switched: {fmtTime(s.switchedAt)}
          </span>
        )}
      </p>

      {dirty && !busy && (
        <p className="mt-1 text-xs text-amber-400">Unsaved change. Hit Save to switch.</p>
      )}
      {fellBack && (
        <p className="mt-1 text-xs text-amber-400">
          You picked Local, but this server can&apos;t reach your Ollama right now, so it&apos;s using Claude. Make sure
          that machine is on with Ollama and Tailscale running, then hit Recheck.
        </p>
      )}
      {pickedNotPulled && (
        <p className="mt-1 text-xs text-amber-400">
          {s.localModel} isn&apos;t pulled on the Ollama box yet, so calls will fail over to Claude. On that machine
          run: <span className="font-mono">ollama pull {s.localModel}</span>, then hit Recheck.
        </p>
      )}
      {s.provider === "claude" && !s.hasCloudKey && (
        <p className="mt-1 text-xs text-amber-400">No ANTHROPIC_API_KEY set, so Claude can&apos;t run here yet.</p>
      )}
      <p className="mt-2 text-xs text-muted">
        Pick the brain and model, then hit Save. The switch takes effect within a few seconds, no restart needed.
        Claude runs everywhere; Local only runs where this server can see your Ollama box.
      </p>
    </div>
  );
}
