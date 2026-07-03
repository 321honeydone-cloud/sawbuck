// Global, owner-controlled app settings backed by the database so they survive
// restarts and redeploys. Today this holds the live AI brain ("claude" vs the
// local Ollama). Reads are cached briefly so the hot AI path does not hit the
// DB on every call. Server-only.

import { prisma } from "./db";

export type AiProvider = "claude" | "ollama";
const AI_KEY = "aiProvider";
const TTL_MS = 4000;

let cached: { value: AiProvider; at: number } | null = null;

/** First-boot default from env, before the owner has ever picked in the UI. */
function envDefault(): AiProvider {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "ollama") return "ollama";
  if (p === "claude") return "claude";
  return process.env.ANTHROPIC_API_KEY ? "claude" : "ollama";
}

/** The brain the owner has chosen (or the env default). Cached for a few seconds. */
export async function getAiProviderSetting(): Promise<AiProvider> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value = envDefault();
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: AI_KEY } });
    if (row?.value === "claude" || row?.value === "ollama") value = row.value;
  } catch {
    // Table may not exist yet (first deploy before db push). Fall back to env.
  }
  cached = { value, at: Date.now() };
  return value;
}

/** Owner picks the brain. Persists to the DB and refreshes the cache now. */
export async function setAiProviderSetting(value: AiProvider): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: AI_KEY },
    update: { value },
    create: { key: AI_KEY, value },
  });
  cached = { value, at: Date.now() };
  await stampSwitch();
}

// ----- Local (Ollama) model pick -----
// Which local text model the owner chose on the Admin screen. Null means "use
// the env default" (OLLAMA_TEXT_MODEL). Validation against the allowed list
// happens in the API route; this layer just stores the string.

const LOCAL_MODEL_KEY = "aiLocalModel";
let cachedLocal: { value: string | null; at: number } | null = null;

/** The local model the owner picked, or null for the env default. Cached briefly. */
export async function getLocalModelSetting(): Promise<string | null> {
  if (cachedLocal && Date.now() - cachedLocal.at < TTL_MS) return cachedLocal.value;
  let value: string | null = null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: LOCAL_MODEL_KEY } });
    if (row?.value) value = row.value;
  } catch {
    // Table may not exist yet. Fall back to the env default.
  }
  cachedLocal = { value, at: Date.now() };
  return value;
}

/** Owner picks the local model. Persists to the DB and refreshes the cache now. */
export async function setLocalModelSetting(value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: LOCAL_MODEL_KEY },
    update: { value },
    create: { key: LOCAL_MODEL_KEY, value },
  });
  cachedLocal = { value, at: Date.now() };
  await stampSwitch();
}

// ----- Switch timestamp -----
// Set every time the owner saves a brain or model change, so the Admin panel
// can show "switched at 2:41 PM" as proof the change actually landed in the DB.

const SWITCHED_AT_KEY = "aiSwitchedAt";

async function stampSwitch(): Promise<void> {
  const value = new Date().toISOString();
  try {
    await prisma.appSetting.upsert({
      where: { key: SWITCHED_AT_KEY },
      update: { value },
      create: { key: SWITCHED_AT_KEY, value },
    });
  } catch {
    // Never let a timestamp write break the actual setting change.
  }
}

/** When the brain or model was last switched (ISO string), or null if never. */
export async function getAiSwitchedAt(): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SWITCHED_AT_KEY } });
    return row?.value || null;
  } catch {
    return null;
  }
}
