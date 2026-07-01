import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/session";
import { uploadsRoot } from "@/lib/uploads";

export const runtime = "nodejs";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

// POST /api/upload (multipart: file, inspectionId) — store inspection media on
// disk under public/uploads and return its URL. Photos and video both go here
// so the database never carries heavy binary blobs.
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_form" }, { status: 400 });
  }
  const file = form.get("file");
  const inspectionId = String(form.get("inspectionId") ?? "misc").replace(/[^A-Za-z0-9_-]/g, "");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });

  const mime = file.type || "application/octet-stream";
  const ext = EXT[mime] ?? (mime.startsWith("video/") ? "mp4" : "jpg");
  const type = mime.startsWith("video/") ? "video" : "image";

  const dir = path.join(uploadsRoot(), inspectionId || "misc");
  await mkdir(dir, { recursive: true });
  const fname = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, fname), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/uploads/${inspectionId || "misc"}/${fname}`, type });
}
