// GET /api/ai/warm — load the local model into VRAM in the background so the
// first real prompt does not have to wait for a cold load. No-op on Claude.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { activeProvider, warmLocalModel } from "@/lib/agents/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const provider = await activeProvider();
  if (provider !== "ollama") return NextResponse.json({ provider, ready: true });

  // Stage-aware: a fresh quote's first prompt runs the first-turn model
  // (gemma), an existing conversation's next prompt runs the steady model
  // (qwen). The client tells us which it is looking at.
  const stage = new URL(req.url).searchParams.get("stage") === "steady" ? "steady" : "first";
  const r = await warmLocalModel(stage);
  return NextResponse.json({ provider: "ollama", ...r });
}
