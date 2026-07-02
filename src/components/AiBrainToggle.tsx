"use client";

// Owner-only switch for the live AI brain. Claude runs everywhere (cloud API).
// Local (Ollama) only works when this server can reach the shop machine, so on
// the hosted site we show it as offline and the app quietly falls back to Claude.
import { useEffect, useState } from "react";

type State = {
  provider: "claude" | "ollama";
  localReachable: boolean;
  localUrl: string;
  hasCloudKey: boolean;
};

export default function AiBrainToggle() {
  const [s, setS] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-provider")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setS(d))
      .catch(() => {});
  }, []);

  async function change(provider: "claude" | "ollama") {
    setSaving(true);
    try {
      const r = await fetch("/api/settings/ai-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (r.ok) setS(await r.json());
    } finally {
      setSaving(false);
    }
  }

  if (!s) return null;

  const localSelectedButOffline = s.provider === "ollama" && !s.localReachable;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ai-brain" className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
          AI brain
        </label>
        <select
          id="ai-brain"
          value={s.provider}
          disabled={saving}
          onChange={(e) => change(e.target.value as "claude" | "ollama")}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-ink disabled:opacity-60"
        >
          <option value="claude">Claude (cloud)</option>
          <option value="ollama">Local (Ollama)</option>
        </select>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          Local:{" "}
          <span className={s.localReachable ? "text-emerald-400" : "text-muted"}>
            {s.localReachable ? "reachable" : "offline here"}
          </span>
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">
        Claude runs everywhere. Local only works where this server can see your Ollama box (your own computer or shop
        network), not the live cloud site.
      </p>
      {localSelectedButOffline && (
        <p className="mt-1 text-xs text-amber-400">
          Local is offline from this server, so AI calls fall back to Claude automatically until Ollama is reachable.
        </p>
      )}
      {s.provider === "claude" && !s.hasCloudKey && (
        <p className="mt-1 text-xs text-amber-400">No ANTHROPIC_API_KEY set, so Claude cannot run here yet.</p>
      )}
    </div>
  );
}
