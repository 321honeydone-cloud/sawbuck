// Summarize a customer's request into a short estimate title (e.g. "Mount TV"
// from "I want to hang up a TV"). Runs on whichever brain is live (Claude or the
// shop Ollama). Best-effort: falls back to a trimmed prompt if the model errors.
import { getSession } from "@/lib/session";
import { activeProvider, localText } from "@/lib/agents/client";
import { deriveJobName } from "@/lib/engine";

export const runtime = "nodejs";

const SYSTEM = `You name job estimates for a handyman and property maintenance business. Given the customer's request (and optionally the line items on the estimate), reply with a SHORT title that names the core job.
Rules:
- 2 to 4 words, Title Case.
- Name the actual work, not the customer's phrasing.
- No punctuation, no quotes, no trailing period, no explanation. Return the title only.
Examples:
- "I want to hang up a tv" => Mount TV
- "need my kitchen faucet swapped and a garbage disposal put in" => Faucet And Disposal
- "paint the whole downstairs and patch some drywall" => Interior Paint And Patch
- "gutter is falling off the back of the house" => Gutter Repair`;

function clean(raw: string): string {
  let t = (raw || "").split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
  t = t.replace(/^["'`\s]+|["'`.\s]+$/g, "");
  t = t.replace(/[^\p{L}\p{N}&/ -]/gu, "");
  t = t.replace(/\s+/g, " ").trim();
  const words = t.split(" ").filter(Boolean).slice(0, 5);
  t = words.join(" ").slice(0, 48).trim();
  t = t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return t;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { message?: string; items?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = (body.message || "").trim().slice(0, 800);
  if (!message) return Response.json({ error: "missing_message" }, { status: 400 });
  const items = Array.isArray(body.items) ? body.items.filter((s) => typeof s === "string").slice(0, 12) : [];

  const prompt = items.length
    ? `Request: ${message}\n\nLine items: ${items.join("; ")}\n\nTitle:`
    : `Request: ${message}\n\nTitle:`;

  // Titles are intentionally FREE: only summarize on the local brain (Ollama),
  // and never fall back to the paid Claude API. If Local is not the active brain
  // or is unreachable, use the offline word-based title instead.
  try {
    if ((await activeProvider()) === "ollama") {
      const raw = await localText({ system: SYSTEM, prompt, temperature: 0.2, timeoutMs: 12000 });
      const title = clean(raw);
      if (title) return Response.json({ title });
    }
  } catch {
    // local model unreachable, fall through to the heuristic
  }
  return Response.json({ title: deriveJobName(message) });
}
