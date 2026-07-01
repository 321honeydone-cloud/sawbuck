// Vision helpers, the photo and PDF readers for the crew.
//
// These used to talk straight to Ollama. Now they go through the provider-aware
// client (../agents/client), so the same code reads job-site photos and PDF
// scopes whether the brain is Claude in the cloud or Ollama in the shop. The
// model only READS and DESCRIBES the work, then the deterministic rate book
// prices it.

import { chatText, VISION_MODEL, TEXT_MODEL } from "./agents/client";
import type { Attachment } from "./types";

const VISION_PROMPT = `You are looking at job-site photos for HoneyDone, a Florida property maintenance and repair contractor. List the work that needs doing in plain English, as short task phrases a contractor would quote, separated by commas. Examples: "replace fascia, clean gutters, patch drywall, replace toilet". Call out materials, fixtures, visible damage, and any rough dimensions you can see. Do not invent work you cannot see. Keep it to one line of comma-separated tasks.`;

const PDF_PROMPT = `Below is the text of a PDF a property maintenance contractor received (a competitor quote, a spec sheet, or a scope of work). List the work to be done as short task phrases, comma-separated, the way a contractor would quote it. Example: "replace fascia, clean gutters, patch drywall". Only include the work itself, not prices, totals, or company names. Keep it to one line of comma-separated tasks.`;

/** Send job-site images to the vision model; get a one-line task list. */
export async function describePhotos(userText: string, images: string[]): Promise<string> {
  if (images.length === 0) return "";
  const content = userText ? `${VISION_PROMPT}\n\nThe user also said: ${userText}` : VISION_PROMPT;
  return chatText({ prompt: content, images, model: VISION_MODEL, temperature: 0.3 });
}

/** Send extracted PDF text to the text model; get a one-line task list. */
export async function describeFromText(userText: string, docText: string): Promise<string> {
  if (!docText.trim()) return "";
  const content = `${PDF_PROMPT}\n\nPDF TEXT:\n${docText.slice(0, 8000)}${userText ? `\n\nThe user also said: ${userText}` : ""}`;
  return chatText({ prompt: content, model: TEXT_MODEL, temperature: 0.3 });
}

/** Split attachments into image payloads (for vision) and pdf payloads (for text). */
export function splitAttachments(attachments: Attachment[]): {
  images: string[];
  pdfs: { name: string; data: string }[];
} {
  const images: string[] = [];
  const pdfs: { name: string; data: string }[] = [];
  for (const a of attachments) {
    if (a.kind === "image") images.push(a.data);
    else if (a.kind === "pdf") pdfs.push({ name: a.name, data: a.data });
  }
  return { images, pdfs };
}
