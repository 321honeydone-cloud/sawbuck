// Estimator chat route, now driven by the local Boss (no paid API).
// The Boss reads the request, sends attachments to the Vision employee, then has
// the Estimator build or edit the quote, all on Manny's own Ollama. Streams
// EngineDeltas as NDJSON. Admins also get trace deltas showing the routing.
import { prisma } from "@/lib/db";
import { RATEBOOK_ID, formatLearnedRates, parseRateBook } from "@/lib/rates";
import { OVERRIDES_ID, applyOverrides, formatPricedBookForPrompt, parseOverrides, pickRelevantTasks } from "@/lib/rateOverrides";
import { formatReferFlagsForPrompt } from "@/lib/referFlags";
import { rateBook, setRateBookTasks } from "@/lib/loadRateBook";
import { memoryBlock } from "@/lib/memory";
import { getSession } from "@/lib/session";
import { activeProvider, prewarmSteadyModel } from "@/lib/agents/client";
import { runChat } from "@/lib/agents/boss";
import type { Attachment, Estimate } from "@/lib/types";
import type { EngineDelta } from "@/lib/engine";
import { driveConfigured } from "@/lib/photo_loader/drive";
import { beforeRoundAttachments } from "@/lib/photo_loader/server";

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
  let attachments = (body.attachments ?? []).slice(0, MAX_ATTACHMENTS);
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => h && (h.role === "user" || h.role === "ai") && typeof h.content === "string")
    .slice(-8)
    .map((h) => ({ role: h.role as "user" | "ai", content: String(h.content).slice(0, 600) }));
  if ((!message && attachments.length === 0) || !estimate) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const session = await getSession();
  const isAdmin = session?.role === "admin";

  // Auto quote: a fresh build with nothing attached loads the matched Before
  // round from the client's Drive folder and hands it to the Vision employee.
  // Only the Before round, never Progress or After, and never when the user
  // attached their own files. Any Drive trouble just means no photos.
  let autoPhotoNote = "";
  const freshBuild = (body.history ?? []).length === 0 && !(estimate.groups ?? []).some((g) => g.items.length > 0);
  if (freshBuild && attachments.length === 0 && estimate.clientName && driveConfigured()) {
    try {
      const { attachments: found, result } = await beforeRoundAttachments(estimate.id, MAX_ATTACHMENTS);
      if (found.length) {
        attachments = found;
        autoPhotoNote = `Photo loader: ${found.length} Before photo${found.length === 1 ? "" : "s"} from Drive (${result.folder?.propertyFolder?.name ?? result.folder?.clientFolder.name ?? "client folder"})`;
      } else if (result.needsYou.length) {
        autoPhotoNote = `Photo loader: nothing attached, ${result.needsYou.length} item${result.needsYou.length === 1 ? "" : "s"} in Needs you`;
      }
    } catch {
      /* Drive down: quote without photos, same as before */
    }
  }

  // Fold the shop's learned rates and full priced book into the estimator prompt.
  let learnedRates = "";
  try {
    const row = await prisma.catalog.findUnique({ where: { id: RATEBOOK_ID } });
    learnedRates = formatLearnedRates(parseRateBook(row?.items));
  } catch {
    /* no rate book yet, static price book still applies */
  }
  let rateBookPrices = "";
  let referBlock = "";
  try {
    const ovRow = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
    const merged = applyOverrides(rateBook.tasks, parseOverrides(ovRow?.items));
    // Load Manny's saved prices into the live engine so the Estimator's
    // server-side rate-book pricing matches the Rate Book screen.
    setRateBookTasks(merged);
    // A local model has to prefill the whole system prompt before its first
    // token, so dumping all 1,100+ priced tasks makes it hang. Give Local only
    // the tasks relevant to this message; Claude still gets the full book.
    const provider = await activeProvider();
    const forPrompt = provider === "ollama" ? pickRelevantTasks(merged, message, 80) : merged;
    rateBookPrices = formatPricedBookForPrompt(forPrompt);
    referBlock = formatReferFlagsForPrompt(forPrompt);
  } catch {
    /* no overrides yet, base book still applies */
  }
  // Shop memory: distilled lessons from every past estimate, including deleted
  // ones, ride into the estimator prompt right alongside the learned rates.
  let shopMemory = "";
  try {
    shopMemory = await memoryBlock();
  } catch {
    /* no memory file yet — the estimator still has the rate books */
  }
  const systemExtra = learnedRates + rateBookPrices + referBlock + shopMemory;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (delta: EngineDelta | { type: "heartbeat" }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(delta) + "\n"));
        } catch {
          closed = true; // client went away; stop writing, let the loop unwind
        }
      };
      // Heartbeat: a local model can think for a minute-plus before its first
      // token, and this stream is silent the whole time. Proxies (Render,
      // Cloudflare) kill silent streams, and the browser cannot tell "thinking"
      // from "dead" — both looked like THE hang. A tiny ignored line every 10s
      // keeps the pipe alive and lets the client run a real stall watchdog.
      const beat = setInterval(() => send({ type: "heartbeat" }), 10000);
      try {
        send({ type: "heartbeat" }); // flush headers + first byte immediately
        if (autoPhotoNote && isAdmin) send({ type: "trace", text: autoPhotoNote });
        for await (const delta of runChat({ message, estimate, attachments, isAdmin, systemExtra, history })) {
          send(delta);
          if (closed) break;
        }
        // Two-stage brain: this quote's NEXT prompt switches to the steady
        // model (qwen), so start loading it now, detached, while the user is
        // still reading this reply. Their second prompt then starts instantly
        // instead of paying the model swap.
        if (history.length === 0 && (await activeProvider()) === "ollama") prewarmSteadyModel();
      } catch (err) {
        send({ type: "error", text: `\n\nThe estimator hit an error: ${(err as Error).message}` });
      } finally {
        clearInterval(beat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by a client disconnect */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
