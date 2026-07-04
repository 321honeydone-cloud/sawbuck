"use client";

// Background local-model warm-up indicator. On mount it hits /api/ai/warm, which
// asks Ollama to load the model into VRAM ahead of the first prompt. While that
// runs it shows a small "Warming <model>" chip so the user knows the box is
// spinning up rather than hung. It disappears once the model is ready (or when
// the brain is Claude, which needs no warm-up).

import { useEffect, useState } from "react";

type Warm = { provider?: string; ready?: boolean; model?: string; error?: string };

export default function LocalModelWarm() {
  const [state, setState] = useState<"warming" | "ready" | "error">("warming");
  const [model, setModel] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/ai/warm")
      .then((r) => (r.ok ? (r.json() as Promise<Warm>) : null))
      .then((d) => {
        if (!live) return;
        if (!d) return setState("error");
        if (d.provider !== "ollama") return setState("ready"); // Claude: nothing to warm
        setModel(d.model || "");
        setState(d.ready ? "ready" : "error");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);

  if (state === "ready") return null;

  const warming = state === "warming";
  return (
    <span
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] sm:inline-flex ${
        warming ? "border-gold/40 bg-gold/10 text-gold" : "border-flag/50 bg-flag/10 text-flag"
      }`}
      title={warming ? "Loading the local model into VRAM" : "Local model did not load; check Ollama"}
    >
      {warming ? (
        <>
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-gold border-t-transparent" aria-hidden />
          Warming{model ? ` ${model}` : " local model"}
        </>
      ) : (
        <>Local model not ready</>
      )}
    </span>
  );
}
