// GET /api/gpu — admin-only snapshot of the shop GPU for the top-bar gauge.
//
// Best-available with graceful fallback:
//   1. nvidia-smi on THIS server (real GPU load % + used/total VRAM). Only works
//      when the app runs on the machine with the GPU (Manny's shop box).
//   2. Ollama /api/ps (VRAM the loaded model is holding + model name). Works
//      anywhere the app can reach the Ollama box, including the cloud deploy.
//   3. Neither reachable -> { reachable: false }, so the gauge shows "GPU offline".

import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getSession } from "@/lib/session";
import { ollamaPs } from "@/lib/agents/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pexec = promisify(exec);

export type GpuStats = {
  source: "nvidia" | "ollama" | null;
  reachable: boolean;
  name?: string | null; // GPU name (nvidia)
  gpuUtil?: number | null; // load percent 0-100, null when unknown
  vramUsedMB?: number | null;
  vramTotalMB?: number | null;
  model?: string | null; // loaded Ollama model(s)
};

async function fromNvidia(): Promise<GpuStats | null> {
  try {
    const { stdout } = await pexec(
      "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,name --format=csv,noheader,nounits",
      { timeout: 4000 }
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
    return null; // nvidia-smi not on this box
  }
}

async function fromOllama(): Promise<GpuStats | null> {
  const ps = await ollamaPs();
  if (ps === null) return null; // box unreachable
  const usedBytes = ps.reduce((s, m) => s + (m.sizeVram || 0), 0);
  const model = ps.map((m) => m.name).filter(Boolean).join(", ") || null;
  return {
    source: "ollama",
    reachable: true,
    name: null,
    gpuUtil: null, // Ollama does not expose GPU load %
    vramUsedMB: usedBytes > 0 ? Math.round(usedBytes / (1024 * 1024)) : 0,
    vramTotalMB: null, // Ollama does not report total VRAM
    model,
  };
}

export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const nvidia = await fromNvidia();
  if (nvidia) return NextResponse.json(nvidia);

  const ollama = await fromOllama();
  if (ollama) return NextResponse.json(ollama);

  const offline: GpuStats = { source: null, reachable: false };
  return NextResponse.json(offline);
}
