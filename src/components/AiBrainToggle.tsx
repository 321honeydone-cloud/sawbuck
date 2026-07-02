"use client";

// Owner-only switch for the live AI brain. Claude runs everywhere (cloud API).
// Local (Ollama) only works when this server can reach your Ollama box (over
// Tailscale on the cloud deploy, or localhost when you run the app yourself).
// The dropdown SAVES the instant you change it, then re-checks and tells you
// plainly which brain is actually live, so there is no guessing.
import { useEffect, useState } from "react";

type State = {
  provider: "claude" | "ollama";
  localReachable: boolean;
  localUrl: string;
  hasCloudKey: boolean;
};

export default function AiBrainToggle() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    const r = await fetch("/api/settings/ai-provider", { cache: "no-store" });
    if (r.ok) setS(await r.json());
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function change(provider: "claude" | "ollama") {
    setBusy(true);
    setSaved(false);
    try {
      const r = await fetch("/api/settings/ai-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (r.ok) {
        setS(await r.json());
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;

  // What will actually answer requests right now.
  const effective: "claude" | "ollama" =
    s.provider === "ollama" ? (s.localReachable ? "ollama" : "claude") : "claude";
  const fellBack = s.provider === "ollama" && !s.localReachable;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ai-brain" className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
          AI brain
        </label>
        <select
          id="ai-brain"
          value={s.provider}
          disabled={busy}
          onChange={(e) => change(e.target.value as "claude" | "ollama")}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-ink disabled:opacity-60"
        >
          <option value="claude">Claude (cloud)</option>
          <option value="ollama">Local (Ollama)</option>
        </select>
        <button
          type="button"
          onClick={() => load()}
          disabled={busy}
          className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-ink disabled:opacity-60"
        >
          {busy ? "Checking..." : "Recheck"}
        </button>
        {saved && !busy && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-emerald-400">Saved</span>}
      </div>

      <p className="mt-2 text-sm text-ink">
        Running on:{" "}
        <span className={effective === "ollama" ? "font-semibold text-emerald-400" : "font-semibold text-gold"}>
          {effective === "ollama" ? "Local (Ollama)" : "Claude (cloud)"}
        </span>
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          local:{" "}
          <span className={s.localReachable ? "text-emerald-400" : "text-muted"}>
            {s.localReachable ? "reachable" : "offline here"}
          </span>
        </span>
      </p>

      {fellBack && (
        <p className="mt-1 text-xs text-amber-400">
          You picked Local, but this server can&apos;t reach your Ollama right now, so it&apos;s using Claude. Make sure
          that machine is on with Ollama and Tailscale running, then hit Recheck.
        </p>
      )}
      {s.provider === "claude" && !s.hasCloudKey && (
        <p className="mt-1 text-xs text-amber-400">No ANTHROPIC_API_KEY set, so Claude can&apos;t run here yet.</p>
      )}
      <p className="mt-2 text-xs text-muted">
        Claude runs everywhere. Local only runs where this server can see your Ollama box. The choice saves instantly, no
        Save button needed.
      </p>
    </div>
  );
}
