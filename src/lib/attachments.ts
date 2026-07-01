// Client-side helpers for turning picked files into Attachments.
// Images are downscaled to Claude's optimal long edge to keep payloads small;
// PDFs are sent as-is.

import type { Attachment } from "./types";

export const MAX_FILES = 10;
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
const MAX_IMAGE_EDGE = 1568; // Claude's recommended max image dimension
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/** Downscale an image so its long edge ≤ MAX_IMAGE_EDGE, return a JPEG data URL. */
async function downscaleImage(file: File): Promise<string> {
  const dataUrl = await readAsDataURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 1_000_000) return dataUrl; // small enough already

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Convert one picked File to an Attachment, or throw with a user-facing reason. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name} is too large (max 15 MB)`);
    const dataUrl = await readAsDataURL(file);
    return { name: file.name, kind: "pdf", mediaType: "application/pdf", data: stripPrefix(dataUrl) };
  }
  if (IMAGE_TYPES.has(file.type)) {
    const dataUrl = await downscaleImage(file);
    const mediaType = dataUrl.slice(5, dataUrl.indexOf(";"));
    return { name: file.name, kind: "image", mediaType, data: stripPrefix(dataUrl) };
  }
  throw new Error(`${file.name}: unsupported type (use images or PDF)`);
}

function stripPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
