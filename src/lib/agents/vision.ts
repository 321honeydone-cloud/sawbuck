// Vision employee, the set of eyes on the crew.
//
// Reads job-site photos and PDF scopes with Manny's local vision model, and
// turns an inspector's photo (or video frames) plus a note into a structured
// Scout issue. Video clips are pulled apart into still frames upstream (in the
// scout route) and arrive here as plain images, so this file never touches the
// filesystem. Server-only.

import { chatText, VISION_MODEL } from "./client";
import { describePhotos, describeFromText, splitAttachments } from "../localLLM";
import { extractPdfText } from "../pdf";
import {
  SCOUT_SYSTEM,
  SEVERITIES,
  TRADES,
  deterministicIssue,
  severityFromText,
  tradeFromText,
} from "../scout";
import type { Attachment, InspectionIssue, IssueSeverity } from "../types";

const FRAME_PROMPT = `You are looking at still frames pulled from a short video a Florida property maintenance contractor took on a job. Across all the frames, list the work that needs doing as short task phrases a contractor would quote, comma separated. Example: "replace fascia, clean gutters, patch drywall". Call out materials, fixtures, visible damage, and rough dimensions. Do not repeat the same task and do not invent work you cannot see. One line of comma separated tasks.`;

/** Describe a set of video frames as a one-line task list (same shape as photos). */
export async function describeFrames(userText: string, frames: string[]): Promise<string> {
  if (frames.length === 0) return "";
  const content = userText ? `${FRAME_PROMPT}\n\nThe user also said: ${userText}` : FRAME_PROMPT;
  return chatText({ prompt: content, images: frames, model: VISION_MODEL, temperature: 0.3 });
}

export interface VisionResult {
  description: string;
  usedImages: number;
  usedPdfs: number;
}

/** Read photo and PDF attachments and return one combined task line. */
export async function describeAttachments(userText: string, attachments: Attachment[]): Promise<VisionResult> {
  const { images, pdfs } = splitAttachments(attachments);
  const parts: string[] = [];

  if (images.length > 0) {
    const fromPhotos = await describePhotos(userText, images);
    if (fromPhotos) parts.push(fromPhotos);
  }

  if (pdfs.length > 0) {
    let pdfText = "";
    for (const pdf of pdfs) {
      try {
        pdfText += "\n" + (await extractPdfText(pdf.data));
      } catch {
        /* scanned or unreadable, skipped below */
      }
    }
    pdfText = pdfText.trim();
    if (pdfText) {
      const fromPdf = await describeFromText(userText, pdfText);
      if (fromPdf) parts.push(fromPdf);
    } else {
      parts.push(`(could not read text from ${pdfs.map((p) => p.name).join(", ")}, likely a scanned PDF)`);
    }
  }

  return {
    description: parts.filter(Boolean).join(". ").trim(),
    usedImages: images.length,
    usedPdfs: pdfs.length,
  };
}

/** Turn an inspector's note + photos/video frames into one structured Scout issue. */
export async function scoutIssue(input: {
  transcript: string;
  images?: string[];
}): Promise<Omit<InspectionIssue, "id" | "position">> {
  const transcript = (input.transcript ?? "").trim();
  const images = input.images ?? [];
  try {
    const content = `${SCOUT_SYSTEM}\n\nInspector note: ${transcript || "(no spoken note, describe what you see)"}`;
    const raw = await chatText({
      prompt: content,
      images: images.length ? images : undefined,
      model: VISION_MODEL,
      format: "json",
      temperature: 0.3,
    });
    const parsed = JSON.parse(raw) as Record<string, string>;
    const forced = severityFromText(transcript);
    const sevOk = (SEVERITIES as string[]).includes(parsed.severity);
    return {
      trade: (TRADES as readonly string[]).includes(parsed.trade)
        ? parsed.trade
        : tradeFromText(transcript || String(parsed.defect || "")),
      severity: forced.explicit ? forced.severity : sevOk ? (parsed.severity as IssueSeverity) : "moderate",
      defect: String(parsed.defect || transcript || "Issue noted during inspection").trim(),
      risk: String(parsed.risk || "May worsen and lead to further damage if left unaddressed.").trim(),
      recommendation: String(parsed.recommendation || "Recommend repair by a qualified contractor.").trim(),
      transcript,
      inspectorSet: forced.explicit,
    };
  } catch {
    return deterministicIssue(transcript);
  }
}
