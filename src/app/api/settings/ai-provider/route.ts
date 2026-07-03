// Owner-only control for the live AI brain. GET returns the current pick plus
// whether the local Ollama box is reachable from THIS server (it will not be on
// the cloud site, which is the point), which local models are available to pick,
// and which of those are actually pulled on the box. POST sets the provider
// (Claude or Local) and/or the local model to run.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getAiProviderSetting,
  setAiProviderSetting,
  setLocalModelSetting,
  getAiSwitchedAt,
  type AiProvider,
} from "@/lib/settings";
import { ollamaTags, activeLocalModel, LOCAL_TEXT_MODELS, OLLAMA_URL } from "@/lib/agents/client";

export const runtime = "nodejs";

async function state() {
  const provider = await getAiProviderSetting();
  const tags = await ollamaTags(); // null = box unreachable from this server
  const localReachable = tags !== null;
  const hasCloudKey = !!process.env.ANTHROPIC_API_KEY;
  const localModel = await activeLocalModel();
  const localModels = LOCAL_TEXT_MODELS.map((name) => ({
    name,
    // A pick like "gemma4" should count as installed when the box reports
    // "gemma4:31b"; exact tag matches too.
    installed: (tags ?? []).some((t) => t === name || t.startsWith(`${name}:`)),
  }));
  const switchedAt = await getAiSwitchedAt();
  return { provider, localReachable, localUrl: OLLAMA_URL, hasCloudKey, localModel, localModels, switchedAt };
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await state());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { provider?: string; localModel?: string };
  try {
    body = (await req.json()) as { provider?: string; localModel?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const provider = body.provider != null ? String(body.provider) : null;
  const localModel = body.localModel != null ? String(body.localModel) : null;
  if (provider == null && localModel == null) {
    return NextResponse.json({ error: "nothing_to_set" }, { status: 400 });
  }

  if (provider != null) {
    if (provider !== "claude" && provider !== "ollama") {
      return NextResponse.json({ error: "bad_provider" }, { status: 400 });
    }
    await setAiProviderSetting(provider as AiProvider);
  }

  if (localModel != null) {
    if (!LOCAL_TEXT_MODELS.includes(localModel)) {
      return NextResponse.json({ error: "bad_local_model" }, { status: 400 });
    }
    await setLocalModelSetting(localModel);
  }

  return NextResponse.json(await state());
}
