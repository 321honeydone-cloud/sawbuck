// Owner-only control for the live AI brain. GET returns the current pick plus
// whether the local Ollama box is reachable from THIS server (it will not be on
// the cloud site, which is the point). POST sets Claude or Local.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAiProviderSetting, setAiProviderSetting, type AiProvider } from "@/lib/settings";
import { ollamaUp, OLLAMA_URL } from "@/lib/agents/client";

export const runtime = "nodejs";

async function state() {
  const provider = await getAiProviderSetting();
  const localReachable = await ollamaUp();
  const hasCloudKey = !!process.env.ANTHROPIC_API_KEY;
  return { provider, localReachable, localUrl: OLLAMA_URL, hasCloudKey };
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await state());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let provider: string;
  try {
    provider = String(((await req.json()) as { provider?: string }).provider ?? "");
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (provider !== "claude" && provider !== "ollama") {
    return NextResponse.json({ error: "bad_provider" }, { status: 400 });
  }
  await setAiProviderSetting(provider as AiProvider);
  return NextResponse.json(await state());
}
