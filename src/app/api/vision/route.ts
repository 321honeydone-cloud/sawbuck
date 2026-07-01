// Vision route, the chat photo/PDF path, on the Vision employee.
// Reads job-site photos and PDFs with the live brain (Claude in the cloud or
// Ollama in the shop) and returns a plain-English task list the rate book can
// price. Video in chat is handled through Scout, where clips are captured.
import { NextResponse } from "next/server";
import { aiReady, MODELS } from "@/lib/agents/client";
import { describeAttachments } from "@/lib/agents/vision";
import type { Attachment } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/vision, read job-site photos and PDFs with the live brain.
export async function POST(req: Request) {
  let body: { message?: string; attachments?: Attachment[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  const attachments = body.attachments ?? [];
  if (attachments.length === 0) {
    return NextResponse.json({ error: "no_attachments" }, { status: 400 });
  }

  if (!(await aiReady())) {
    const detail =
      MODELS.provider === "claude"
        ? "The cloud brain is not configured. Set ANTHROPIC_API_KEY."
        : `No local model at ${MODELS.url}. Start Ollama first.`;
    return NextResponse.json({ error: "ai_down", detail }, { status: 503 });
  }

  try {
    const v = await describeAttachments(message, attachments);
    return NextResponse.json({
      description: v.description,
      engine: MODELS.provider,
      visionModel: v.usedImages ? MODELS.vision : null,
      textModel: v.usedPdfs ? MODELS.text : null,
    });
  } catch (e) {
    return NextResponse.json({ error: "vision_failed", detail: (e as Error).message }, { status: 502 });
  }
}
