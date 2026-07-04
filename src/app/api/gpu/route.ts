// GET /api/gpu — admin-only snapshot of the shop GPU for the top-bar gauge.
//
// Best-available with graceful fallback:
//   1. nvidia-smi on THIS server: real load % + used/total VRAM. Only works on
//      an NVIDIA box with the app running on the machine that has the GPU.
//   2. Windows perf counters (typeperf) for GPU load %: vendor-agnostic, so an
//      AMD or Intel GPU still reports a load %. Paired with Ollama for VRAM.
//   3. Ollama /api/ps for the VRAM the loaded model is holding + model name.
//      Works anywhere the app can reach the Ollama box (including the cloud).
//   4. Nothing reachable -> { reachable: false } and the gauge shows "GPU offline".

import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getSession } from "@/lib/session";
import { ollamaPs } from "@/lib/agents/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pexec = promisify(exec);

export type GpuStats = {
  source: "nvidia" | "system" | "ollama" | null;
  reachable: boolean;
  name?: string | null; // GPU name (nvidia)
  gpuUtil?: number | null; // load percent 0-100, null when unknown
  vramUsedMB?: number | null;
  vramTotalMB?: number | null;
  model?: string | null; // loaded Ollama model(s)
};

// 1) NVIDIA: full picture (load % + used/total VRAM).
async function fromNvidia(): Promise<GpuStats | null> {
  try {
    const { stdout } = await pexec(
      "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,name --format=csv,noheader,nounits",
      { timeout: 4000, windowsHide: true }
    );
    const line = stdout.trim().split("\n")[0];
    if (!line) return null;
    const parts = line.split(",").map((s) => s.trim());
    const [util, used, total] = parts;
    const name = parts.slice(3).join(",").trim();
    return {
      source: "nvidia",
      reachable: true,
      name: name || null,
      gpuUtil: Number.isFinite(Number(util)) ? Number(util) : null,
      vramUsedMB: Number.isFinite(Number(used)) ? Number(used) : null,
      vramTotalMB: Number.isFinite(Number(total)) ? Number(total) : null,
    };
  } catch {
    return null; // nvidia-smi not on this box (no NVIDIA GPU, or app not on the GPU host)
  }
}

// 2) Windows perf counters: GPU load % for ANY vendor (AMD / Intel / NVIDIA).
// Sums utilization across all GPU engine instances and caps at 100.
async function windowsGpuUtil(): Promise<number | null> {
  try {
    // -sc 2: GPU counters often report nothing on the very first sample, so we
    // take two and use the last data row.
    const { stdout } = await pexec(
      'typeperf "\\GPU Engine(*)\\Utilization Percentage" -sc 2',
      { timeout: 8000, windowsHide: true }
    );
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    // The data row starts with a quoted timestamp, e.g. "07/03/2026 02:31:00.000".
    const dataLine = [...lines].reverse().find((l) => /^"\d/.test(l));
    if (!dataLine) return null;
    const nums = dataLine
      .split(",")
      .slice(1)
      .map((c) => Number(c.replace(/"/g, "")))
      .filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    const sum = nums.reduce((s, n) => s + n, 0);
    return Math.max(0, Math.min(100, Math.round(sum)));
  } catch {
    return null; // not Windows, or counters unavailable
  }
}

// 3) Ollama: VRAM the loaded model(s) are holding, plus the model name(s).
async function fromOllama(): Promise<{ vramUsedMB: number; model: string | null } | null> {
  const ps = await ollamaPs();
  if (ps === null) return null; // box unreachable
  const usedBytes = ps.reduce((s, m) => s + (m.sizeVram || 0), 0);
  const model = ps.map((m) => m.name).filter(Boolean).join(", ") || null;
  return { vramUsedMB: usedBytes > 0 ? Math.round(usedBytes / (1024 * 1024)) : 0, model };
}

export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Best case: NVIDIA gives everything in one shot.
  const nvidia = await fromNvidia();
  if (nvidia) return NextResponse.json(nvidia);

  // Otherwise combine a vendor-agnostic load % with Ollama's VRAM reading.
  const [util, ollama] = await Promise.all([windowsGpuUtil(), fromOllama()]);
  if (util != null || ollama) {
    const merged: GpuStats = {
      source: "system",
      reachable: true,
      name: null,
      gpuUtil: util,
      vramUsedMB: ollama?.vramUsedMB ?? null,
      vramTotalMB: null,
      model: ollama?.model ?? null,
    };
    return NextResponse.json(merged);
  }

  const offline: GpuStats = { source: null, reachable: false };
  return NextResponse.json(offline);
}
