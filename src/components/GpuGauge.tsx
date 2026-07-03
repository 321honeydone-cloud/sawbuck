"use client";

// Admin-only GPU/VRAM gauge for the top bar, sitting to the right of the AI
// updates badge. Polls /api/gpu every 5s. Shows real GPU load % + used/total
// VRAM when nvidia-smi is available on the shop box, otherwise the VRAM the
// loaded Ollama model is holding. When the box is unreachable it shows a dim
// "GPU offline" chip so the layout stays put. Renders nothing for non-admins.

import { useEffect, useState } from "react";
import type { GpuStats } from "@/app/api/gpu/route";

const fmtVram = (mb?: number | null): string | null => {
  if (mb == null) return null;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`;
};

export default function GpuGauge() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [stats, setStats] = useState<GpuStats | null>(null);

  // Only admins see and poll the gauge.
  useEffect(() => {
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setAdmin(d?.role === "admin"))
      .catch(() => live && setAdmin(false));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/gpu", { cache: "no-store" });
        const d = r.ok ? ((await r.json()) as GpuStats) : { source: null, reachable: false };
        if (live) setStats(d);
      } catch {
        if (live) setStats({ source: null, reachable: false });
      }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [admin]);

  if (!admin) return null;

  const offline = !stats || !stats.reachable;

  if (offline) {
    return (
      <span
        className="hidden items-center gap-1.5 rounded-full border border-border bg-card-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted sm:inline-flex"
        title="Shop GPU not reachable"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted/60" aria-hidden />
        GPU offline
      </span>
    );
  }

  const util = stats?.gpuUtil ?? null;
  const usedVram = fmtVram(stats?.vramUsedMB);
  const totalVram = fmtVram(stats?.vramTotalMB);
  const vramPct =
    stats?.vramUsedMB != null && stats?.vramTotalMB
      ? Math.min(100, Math.round((stats.vramUsedMB / stats.vramTotalMB) * 100))
      : null;
  const vramLabel = usedVram ? (totalVram ? `${usedVram}/${totalVram}` : usedVram) : "—";
  const title = stats?.name || stats?.model || "Shop GPU";

  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] sm:inline-flex"
      title={title}
    >
      {util != null ? (
        <span className="flex items-center gap-1 text-brand">
          <MiniBar pct={util} />
          {Math.round(util)}%
        </span>
      ) : (
        <span className="text-gold">VRAM</span>
      )}
      <span className="text-ink">
        {vramLabel}
        {vramPct != null ? ` · ${vramPct}%` : ""}
      </span>
    </span>
  );
}

function MiniBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <span className="inline-block h-1.5 w-8 overflow-hidden rounded-full bg-card-2" aria-hidden>
      <span className="block h-full rounded-full bg-brand" style={{ width: `${w}%` }} />
    </span>
  );
}
