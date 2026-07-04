// AI client core, the shared nervous system every agent talks through.
//
// One brain, two providers. In the cloud the crew runs on Claude (Anthropic),
// so anyone you hand the app to gets a reliable brain with no install. In the
// shop you can still run everything free on your own Ollama box. This file is
// the only place that knows either wire format, so the rest of the crew never
// has to care which one is live.
//
// Provider is chosen by AI_PROVIDER ("claude" | "ollama" | "auto", default auto).
// auto = Claude when ANTHROPIC_API_KEY is set, otherwise Ollama.
//
// Cloud env:  ANTHROPIC_API_KEY, CLAUDE_TEXT_MODEL, CLAUDE_FAST_MODEL, CLAUDE_MAX_TOKENS
// Shop env:   OLLAMA_URL, OLLAMA_TEXT_MODEL, OLLAMA_VISION_MODEL

import { makeAnthropic } from "../anthropic";
import { getAiProviderSetting, getLocalModelSetting } from "../settings";
import { ProxyAgent } from "undici";

// ----- Shop (Ollama) settings -----
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || "qwen3-32b-manny";
// Must match a multimodal tag you have actually pulled (for example llava or
// llama3.2-vision). The old default gemma4:26B is not a real tag, so photo
// reading never worked in shop mode until this was set right.
export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "llama3.2-vision";

// Local text models the owner can pick from on the Admin screen. The env
// default is always first. Add or swap options with OLLAMA_EXTRA_TEXT_MODELS
// (comma-separated tags); gemma4:31b ships as the built-in second option.
// A tag here must match what `ollama list` shows on the shop box exactly, or
// calls to it fail and the app falls back to Claude.
export const LOCAL_TEXT_MODELS: string[] = Array.from(
  new Set([
    TEXT_MODEL,
    ...(process.env.OLLAMA_EXTRA_TEXT_MODELS || "gemma4:31b")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ])
);

/** The local text model to use right now: the owner's pick, else the env default. */
export async function activeLocalModel(): Promise<string> {
  try {
    const picked = await getLocalModelSetting();
    if (picked && LOCAL_TEXT_MODELS.includes(picked)) return picked;
  } catch {
    /* fall through to the env default */
  }
  return TEXT_MODEL;
}

// On the cloud deploy the app reaches the shop Ollama over Tailscale's userspace
// outbound HTTP proxy (Render cannot run a normal VPN interface). When
// OLLAMA_HTTP_PROXY is set we route every Ollama call through it; locally the
// env is unset and calls go straight to 127.0.0.1.
const OLLAMA_HTTP_PROXY = process.env.OLLAMA_HTTP_PROXY || "";
let ollamaDispatcher: ProxyAgent | undefined;
function ollamaInit<T extends Record<string, unknown>>(init: T): T {
  if (!OLLAMA_HTTP_PROXY) return init;
  if (!ollamaDispatcher) ollamaDispatcher = new ProxyAgent(OLLAMA_HTTP_PROXY);
  return { ...init, dispatcher: ollamaDispatcher };
}

// ----- Cloud (Claude) settings -----
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
export const CLAUDE_TEXT_MODEL = process.env.CLAUDE_TEXT_MODEL || "claude-sonnet-4-6";
export const CLAUDE_FAST_MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-4-5-20251001";
const CLAUDE_MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS || 4096);

function pickProvider(): "claude" | "ollama" {
  const p = (process.env.AI_PROVIDER || "auto").toLowerCase();
  if (p === "claude") return "claude";
  if (p === "ollama") return "ollama";
  return ANTHROPIC_KEY ? "claude" : "ollama";
}

/** Which brain is live for this server process. */
export const PROVIDER: "claude" | "ollama" = pickProvider();

/**
 * The brain to use for THIS request. The owner picks Claude or Local (Ollama)
 * from the Admin screen and the choice lives in the database, so it survives
 * restarts. Safety net: if Local is picked but the Ollama box is not reachable
 * from this server (for example the live cloud site, which cannot see the shop
 * machine), we fall back to Claude so the app never goes dark. Env AI_PROVIDER
 * is only the first-boot default now.
 */
export async function activeProvider(): Promise<"claude" | "ollama"> {
  // Return the brain the owner actually picked. We do NOT pre-check whether
  // Ollama is reachable here: a slow tunnel ping used to false-trip and silently
  // send everything to Claude. Instead, chatText/chatStream try Ollama for real
  // and fall back to Claude only if the call genuinely errors.
  try {
    return await getAiProviderSetting();
  } catch {
    return PROVIDER;
  }
}

/** Cloud brain readiness + key, for agents that need Claude-only features like web search. */
export async function cloudBrain(): Promise<{ ready: boolean; key: string }> {
  const provider = await activeProvider();
  return { ready: provider === "claude" && !!ANTHROPIC_KEY, key: ANTHROPIC_KEY };
}

const CHAT = `${OLLAMA_URL}/api/chat`;

type Msg = { role: "system" | "user" | "assistant"; content: string; images?: string[] };

export interface ChatOpts {
  system?: string;
  prompt: string;
  images?: string[];
  model?: string;
  /** Pass "json" or a JSON schema object for structured output. */
  format?: "json" | Record<string, unknown>;
  timeoutMs?: number;
  /** Lower for routing (snappy), higher for estimating (room to reason). */
  temperature?: number;
}

// ===================================================================
// Provider-agnostic entry points. The crew only ever calls these.
// ===================================================================

/** One-shot text completion. Returns the assistant content, trimmed. */
export async function chatText(opts: ChatOpts): Promise<string> {
  const provider = await activeProvider();
  if (provider !== "ollama") return claudeText(opts);
  // Local mode stays local: if Ollama errors we do NOT silently fall back to the
  // paid Claude API (that was a hidden cost). Fail loudly so the owner fixes the
  // local box, or switches to Claude on purpose.
  return ollamaText(opts);
}

/** Local-brain-only completion. Never falls back to the paid Claude API, so
 *  callers that must stay free (e.g. estimate titles) can opt out of cost.
 *  Throws if the local model is unreachable, let the caller handle fallback. */
export async function localText(opts: ChatOpts): Promise<string> {
  return ollamaText(opts);
}

/** Structured completion. Asks for JSON and parses it. Returns null on bad JSON. */
export async function chatJson<T>(opts: ChatOpts & { schema?: Record<string, unknown> }): Promise<T | null> {
  const raw = await chatText({ ...opts, format: opts.schema ?? "json" });
  return parseLooseJson<T>(raw);
}

/** Streaming text completion. Yields content chunks as they arrive. */
export async function* chatStream(opts: ChatOpts): AsyncGenerator<string> {
  const provider = await activeProvider();
  if (provider !== "ollama") {
    yield* claudeStream(opts);
    return;
  }
  // Local mode stays local: no silent Claude fallback on an Ollama error.
  yield* ollamaStream(opts);
}

/** Is the live brain reachable right now? Provider-aware so callers fall back fast. */
export async function aiReady(): Promise<boolean> {
  const provider = await activeProvider();
  if (provider === "claude") return !!ANTHROPIC_KEY;
  return ollamaUp();
}

/** Is the local Ollama reachable right now? Kept for shop mode and back-compat. */
export async function ollamaUp(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, ollamaInit({ signal: AbortSignal.timeout(6000) }) as RequestInit);
    return r.ok;
  } catch {
    return false;
  }
}

/** Model tags the local Ollama box reports, or null when it is unreachable.
 * Lets the Admin screen show which local models are actually pulled. */
export async function ollamaTags(): Promise<string[] | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, ollamaInit({ signal: AbortSignal.timeout(6000) }) as RequestInit);
    if (!r.ok) return null;
    const data = (await r.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => String(m.name ?? "")).filter(Boolean);
  } catch {
    return null;
  }
}

/** Models currently loaded in the local Ollama box, with the VRAM (bytes) each
 * is holding. null when the box is unreachable. Powers the admin GPU gauge when
 * nvidia-smi is not available on this server (e.g. the cloud deploy). */
export async function ollamaPs(): Promise<{ name: string; sizeVram: number }[] | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/ps`, ollamaInit({ signal: AbortSignal.timeout(6000) }) as RequestInit);
    if (!r.ok) return null;
    const data = (await r.json()) as { models?: { name?: string; size_vram?: number }[] };
    return (data.models ?? []).map((m) => ({ name: String(m.name ?? ""), sizeVram: Number(m.size_vram ?? 0) }));
  } catch {
    return null;
  }
}

/**
 * Warm the local model: ask Ollama to load it into VRAM in the background (empty
 * prompt = load only, no generation) and keep it resident. Firing this on page
 * load means the model is ready before the first real prompt, so the estimator
 * does not appear to hang while a 31B model loads on the first message.
 */
export async function warmLocalModel(): Promise<{ ready: boolean; model: string; ms: number; error?: string }> {
  const t0 = Date.now();
  let model = "";
  // Deliberately NO app-level lock here. Warming used to take the generation
  // lock and hold it for up to 300s while a cold 31B model loaded, so the
  // user's first real prompt sat queued behind the warm-up doing nothing.
  // That was the "hang after the first prompt". Warming targets the SAME model
  // the estimator uses, and Ollama queues same-model requests internally, so a
  // prompt that arrives mid-load simply runs the moment the load finishes.
  try {
    model = await resolveModel(await activeLocalModel());
    // Already resident in VRAM? Then there is nothing to warm; answer instantly
    // instead of issuing another load call (page navigations fire this a lot).
    const loaded = await ollamaPs();
    if (loaded?.some((m) => m.name === model || m.name.startsWith(`${model}:`))) {
      return { ready: true, model, ms: Date.now() - t0 };
    }
    const r = await fetch(`${OLLAMA_URL}/api/generate`, ollamaInit({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "", keep_alive: "30m" }),
      signal: AbortSignal.timeout(300000), // a big model can take a few minutes to load cold
    }) as RequestInit);
    if (!r.ok) return { ready: false, model, ms: Date.now() - t0, error: `Ollama returned ${r.status}` };
    await r.json().catch(() => ({}));
    return { ready: true, model, ms: Date.now() - t0 };
  } catch (e) {
    return { ready: false, model, ms: Date.now() - t0, error: (e as Error).message };
  }
}

// ===================================================================
// Claude (cloud) provider
// ===================================================================

/** Pick the Claude model. A caller may force one by passing a "claude-" model. */
function claudeModel(model?: string): string {
  return model && model.startsWith("claude") ? model : CLAUDE_TEXT_MODEL;
}

/** Build a Claude user-message body: a plain string, or image blocks plus text. */
function claudeContent(prompt: string, images?: string[]): unknown {
  if (!images || images.length === 0) return prompt;
  const blocks: unknown[] = images.map((b64) => ({
    type: "image",
    source: { type: "base64", media_type: sniffImageMediaType(b64), data: stripDataPrefix(b64) },
  }));
  blocks.push({ type: "text", text: prompt });
  return blocks;
}

async function claudeText(opts: ChatOpts): Promise<string> {
  const client = makeAnthropic(ANTHROPIC_KEY);
  const wantJson = !!opts.format;
  const system =
    (opts.system ? opts.system : "") +
    (wantJson ? "\n\nRespond with ONLY one valid JSON object and nothing else. No prose and no code fences." : "");
  const resp = await client.messages.create({
    model: claudeModel(opts.model),
    max_tokens: CLAUDE_MAX_TOKENS,
    // temperature is intentionally omitted: newer Claude models (Sonnet 5 and up)
    // reject it as deprecated. The Ollama path below still honors opts.temperature.
    ...(system.trim() ? { system: system.trim() } : {}),
    // Cast: image blocks are built loosely above, the SDK validates at runtime.
    messages: [{ role: "user", content: claudeContent(opts.prompt, opts.images) as never }],
  });
  const text = resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  return wantJson ? extractJsonString(text) : text;
}

async function* claudeStream(opts: ChatOpts): AsyncGenerator<string> {
  const client = makeAnthropic(ANTHROPIC_KEY);
  const stream = client.messages.stream({
    model: claudeModel(opts.model),
    max_tokens: CLAUDE_MAX_TOKENS,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: claudeContent(opts.prompt, opts.images) as never }],
  });
  for await (const event of stream as AsyncIterable<{ type: string; delta?: { type?: string; text?: string } }>) {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
      yield event.delta.text;
    }
  }
}

// ===================================================================
// Shop (Ollama) provider
// ===================================================================

function buildMessages(system: string | undefined, prompt: string, images?: string[]): Msg[] {
  const msgs: Msg[] = [];
  if (system) msgs.push({ role: "system", content: system });
  const user: Msg = { role: "user", content: prompt };
  if (images && images.length) user.images = images.map(stripDataPrefix);
  msgs.push(user);
  return msgs;
}

/** Pick a model that is actually pulled on the box. Prevents an instant 404 when
 *  the configured tag (e.g. qwen3-32b-manny) does not match what `ollama list`
 *  shows. Falls back to the first configured model that IS installed, else the
 *  first tag the box reports. Returns the preferred name if we cannot list. */
async function resolveModel(preferred: string): Promise<string> {
  try {
    const tags = await ollamaTags();
    if (!tags || tags.length === 0) return preferred;
    const has = (name: string) => tags.some((t) => t === name || t.startsWith(`${name}:`));
    if (has(preferred)) return preferred;
    const pick = LOCAL_TEXT_MODELS.find(has) || tags[0];
    console.warn(`[ai] local model "${preferred}" is not pulled on ${OLLAMA_URL}; using "${pick}" instead`);
    return pick;
  } catch {
    return preferred;
  }
}

/** Turn a fetch failure into a message that says what to actually check. */
function ollamaReachError(e: unknown, timeoutMs?: number): string {
  const err = e as Error;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return `The local model did not respond within ${Math.round((timeoutMs ?? 180000) / 1000)}s. A large model can take a while to load into VRAM on the first request. Try again, or pick a smaller model in Admin.`;
  }
  return `Cannot reach Ollama at ${OLLAMA_URL} (${err?.message || "connection error"}). Make sure "ollama serve" is running and OLLAMA_URL points at it.`;
}

function ollamaHttpError(model: string, status: number): string {
  if (status === 404) {
    return `Ollama has no model tagged "${model}". Run "ollama list", then pull that tag or pick an installed model in Admin.`;
  }
  return `Local model "${model}" returned ${status} from ${OLLAMA_URL}.`;
}

// Serialize every GENERATION request to the single local Ollama box. One GPU can
// only run one big model at a time; firing a second generation while one is in
// flight makes Ollama try to spin up another copy (VRAM thrash) and BOTH stall
// out to the 180s timeout. That is exactly the "first prompt fast, second one
// like pulling teeth then it errors" symptom: a background call (auto-title,
// warm-up, memory compaction) was still holding the GPU when the next prompt
// fired. This lock makes them take turns, so each stays fast. Lightweight
// metadata calls (tags, ps) are NOT locked.
let ollamaTail: Promise<void> = Promise.resolve();
let ollamaWaiters = 0; // how many generations hold or wait on the lock right now
async function acquireOllama(): Promise<() => void> {
  ollamaWaiters++;
  let done = false;
  let release!: () => void;
  const mine = new Promise<void>((res) => (release = res));
  const prev = ollamaTail;
  ollamaTail = mine;
  await prev;
  return () => {
    if (done) return; // idempotent: a double release must not corrupt the count
    done = true;
    ollamaWaiters--;
    release();
  };
}

/** True while a generation holds (or waits on) the local GPU. Background jobs
 *  (memory compaction, warm-up refresh) check this and step aside so a live
 *  user prompt is never stuck queued behind housekeeping. */
export function ollamaBusy(): boolean {
  return ollamaWaiters > 0;
}

async function ollamaText(opts: ChatOpts): Promise<string> {
  const model = opts.model || (await resolveModel(await activeLocalModel()));
  const release = await acquireOllama();
  try {
    let r: Response;
    try {
      r = await fetch(CHAT, ollamaInit({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          keep_alive: "30m", // keep the model resident so later calls do not reload it
          ...(opts.format ? { format: opts.format } : {}),
          options: { temperature: opts.temperature ?? 0.4 },
          messages: buildMessages(opts.system, opts.prompt, opts.images),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
      }) as RequestInit);
    } catch (e) {
      throw new Error(ollamaReachError(e, opts.timeoutMs));
    }
    if (!r.ok) throw new Error(ollamaHttpError(model, r.status));
    const data = (await r.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "").trim();
  } finally {
    release();
  }
}

async function* ollamaStream(opts: ChatOpts): AsyncGenerator<string> {
  const model = opts.model || (await resolveModel(await activeLocalModel()));
  const release = await acquireOllama();
  try {
    let r: Response;
    try {
      r = await fetch(CHAT, ollamaInit({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          think: false,
          keep_alive: "30m", // keep the model resident so later calls do not reload it
          options: { temperature: opts.temperature ?? 0.4 },
          messages: buildMessages(opts.system, opts.prompt, opts.images),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
      }) as RequestInit);
    } catch (e) {
      throw new Error(ollamaReachError(e, opts.timeoutMs));
    }
    if (!r.ok || !r.body) throw new Error(ollamaHttpError(model, r.status));
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const chunk = obj.message?.content;
          if (chunk) yield chunk;
        } catch {
          // partial line, ignore, the next read completes it
        }
      }
    }
  } finally {
    release(); // let the next Ollama call run once this stream is fully consumed
  }
}

// ===================================================================
// Helpers
// ===================================================================

/** Drop a data: URI prefix if a caller passed a full data URL instead of raw base64. */
export function stripDataPrefix(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}

/** Guess an image media type from the first bytes of its base64, default jpeg. */
export function sniffImageMediaType(b64: string): string {
  const s = stripDataPrefix(b64);
  if (s.startsWith("iVBORw0KGgo")) return "image/png";
  if (s.startsWith("R0lGOD")) return "image/gif";
  if (s.startsWith("UklGR")) return "image/webp";
  if (s.startsWith("/9j/")) return "image/jpeg";
  return "image/jpeg";
}

/** Pull a clean JSON string out of a model reply, tolerant of fences or chatter. */
export function extractJsonString(raw: string): string {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1);
  return cleaned;
}

/** Pull a JSON object out of a model reply, tolerant of stray prose or fences. */
export function parseLooseJson<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Live view of the active brain + model names, for status displays. */
export async function currentModels(): Promise<{
  provider: "claude" | "ollama";
  url: string;
  text: string;
  vision: string;
}> {
  const provider = await activeProvider();
  return {
    provider,
    url: provider === "claude" ? "Anthropic API" : OLLAMA_URL,
    text: provider === "claude" ? CLAUDE_TEXT_MODEL : await activeLocalModel(),
    vision: provider === "claude" ? CLAUDE_TEXT_MODEL : VISION_MODEL,
  };
}
