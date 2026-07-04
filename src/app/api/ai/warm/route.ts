// GET /api/ai/warm — load the local model into VRAM in the background so the
// first real prompt does not have to wait for a cold load. No-op on Claude.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { activeProvider, warmLocalModel } from "@/lib/agents/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const provider = await activeProvider();
  if (provider !== "ollama") return NextResponse.json({ provider, ready: true });

  const r = await warmLocalModel();
  return NextResponse.json({ provider: "ollama", ...r });
}
