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
import { getAiProviderSetting } from "../settings";

// ----- Shop (Ollama) settings -----
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || "qwen3-32b-manny";
// Must match a multimodal tag you have actually pulled (for example llava or
// llama3.2-vision). The old default gemma4:26B is not a real tag, so photo
// reading never worked in shop mode until this was set right.
export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "llama3.2-vision";

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
  let chosen: "claude" | "ollama";
  try {
    chosen = await getAiProviderSetting();
  } catch {
    chosen = PROVIDER;
  }
  if (chosen === "ollama") {
    if (await ollamaUp()) return "ollama";
    return ANTHROPIC_KEY ? "claude" : "ollama";
  }
  if (ANTHROPIC_KEY) return "claude";
  return (await ollamaUp()) ? "ollama" : "claude";
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
  return provider === "claude" ? claudeText(opts) : ollamaText(opts);
}

/** Structured completion. Asks for JSON and parses it. Returns null on bad JSON. */
export async function chatJson<T>(opts: ChatOpts & { schema?: Record<string, unknown> }): Promise<T | null> {
  const raw = await chatText({ ...opts, format: opts.schema ?? "json" });
  return parseLooseJson<T>(raw);
}

/** Streaming text completion. Yields content chunks as they arrive. */
export async function* chatStream(opts: ChatOpts): AsyncGenerator<string> {
  const provider = await activeProvider();
  if (provider === "claude") {
    yield* claudeStream(opts);
    return;
  }
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
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
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

async function ollamaText(opts: ChatOpts): Promise<string> {
  const r = await fetch(CHAT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model || TEXT_MODEL,
      stream: false,
      think: false,
      ...(opts.format ? { format: opts.format } : {}),
      options: { temperature: opts.temperature ?? 0.4 },
      messages: buildMessages(opts.system, opts.prompt, opts.images),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
  });
  if (!r.ok) throw new Error(`Ollama ${opts.model || TEXT_MODEL} ${r.status}`);
  const data = (await r.json()) as { message?: { content?: string } };
  return (data.message?.content ?? "").trim();
}

async function* ollamaStream(opts: ChatOpts): AsyncGenerator<string> {
  const r = await fetch(CHAT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model || TEXT_MODEL,
      stream: true,
      think: false,
      options: { temperature: opts.temperature ?? 0.4 },
      messages: buildMessages(opts.system, opts.prompt, opts.images),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180000),
  });
  if (!r.ok || !r.body) throw new Error(`Ollama stream ${opts.model || TEXT_MODEL} ${r.status}`);
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
    text: provider === "claude" ? CLAUDE_TEXT_MODEL : TEXT_MODEL,
    vision: provider === "claude" ? CLAUDE_TEXT_MODEL : VISION_MODEL,
  };
}
