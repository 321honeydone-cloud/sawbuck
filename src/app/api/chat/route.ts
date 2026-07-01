// Estimator chat route, now driven by the local Boss (no paid API).
// The Boss reads the request, sends attachments to the Vision employee, then has
// the Estimator build or edit the quote, all on Manny's own Ollama. Streams
// EngineDeltas as NDJSON. Admins also get trace deltas showing the routing.
import { prisma } from "@/lib/db";
import { RATEBOOK_ID, formatLearnedRates, parseRateBook } from "@/lib/rates";
import { OVERRIDES_ID, applyOverrides, formatPricedBookForPrompt, parseOverrides } from "@/lib/rateOverrides";
import { rateBook, setRateBookTasks } from "@/lib/loadRateBook";
import { getSession } from "@/lib/session";
import { runChat } from "@/lib/agents/boss";
import type { Attachment, Estimate } from "@/lib/types";
import type { EngineDelta } from "@/lib/engine";

export const runtime = "nodejs";

const MAX_ATTACHMENTS = 10;

// POST /api/chat, stream the local Boss as NDJSON EngineDeltas.
export async function POST(req: Request) {
  let body: { message?: string; estimate?: Estimate; attachments?: Attachment[]; history?: { role?: string; content?: string }[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  const estimate = body.estimate;
  const attachments = (body.attachments ?? []).slice(0, MAX_ATTACHMENTS);
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => h && (h.role === "user" || h.role === "ai") && typeof h.content === "string")
    .slice(-8)
    .map((h) => ({ role: h.role as "user" | "ai", content: String(h.content).slice(0, 600) }));
  if ((!message && attachments.length === 0) || !estimate) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const session = await getSession();
  const isAdmin = session?.role === "admin";

  // Fold the shop's learned rates and full priced book into the estimator prompt.
  let learnedRates = "";
  try {
    const row = await prisma.catalog.findUnique({ where: { id: RATEBOOK_ID } });
    learnedRates = formatLearnedRates(parseRateBook(row?.items));
  } catch {
    /* no rate book yet, static price book still applies */
  }
  let rateBookPrices = "";
  try {
    const ovRow = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
    const merged = applyOverrides(rateBook.tasks, parseOverrides(ovRow?.items));
    // Load Manny's saved prices into the live engine so the Estimator's
    // server-side rate-book pricing matches the Rate Book screen.
    setRateBookTasks(merged);
    rateBookPrices = formatPricedBookForPrompt(merged);
  } catch {
    /* no overrides yet, base book still applies */
  }
  const systemExtra = learnedRates + rateBookPrices;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (delta: EngineDelta) => controller.enqueue(encoder.encode(JSON.stringify(delta) + "\n"));
      try {
        for await (const delta of runChat({ message, estimate, attachments, isAdmin, systemExtra, history })) {
          send(delta);
        }
      } catch (err) {
        send({ type: "text", text: `\n\n[The estimator hit an error: ${(err as Error).message}]` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
