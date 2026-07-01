// Scout route, now on the Vision employee, photos AND video.
// A photo plus an inspector's spoken note becomes a structured issue. Video
// clips already on disk (from /api/upload) are pulled apart into still frames
// with ffmpeg and read like extra photos. Deterministic fallback when the local
// model is unreachable.
import { NextResponse } from "next/server";
import path from "path";
import { getSession } from "@/lib/session";
import { aiReady } from "@/lib/agents/client";
import { scoutIssue } from "@/lib/agents/vision";
import { extractFramesFromFile } from "@/lib/agents/video";
import { deterministicIssue } from "@/lib/scout";
import { uploadsRoot } from "@/lib/uploads";

export const runtime = "nodejs";

const MAX_IMAGES = 10;
const FRAMES_PER_CLIP = 4;

/** Map a safe /uploads/... URL to its file on disk, or null if it looks off. */
function uploadUrlToPath(url: string): string | null {
  if (typeof url !== "string") return null;
  const clean = url.split("?")[0];
  if (!clean.startsWith("/uploads/") || clean.includes("..")) return null;
  return path.join(uploadsRoot(), clean.replace(/^\/uploads\//, ""));
}

// POST /api/scout { transcript, image|images, videos }, build one inspection issue.
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { transcript?: string; image?: string; images?: string[]; videos?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const transcript = String(body.transcript ?? "").trim();
  const images = Array.isArray(body.images)
    ? body.images.filter((x): x is string => typeof x === "string")
    : typeof body.image === "string" && body.image
      ? [body.image]
      : [];
  const videos = Array.isArray(body.videos) ? body.videos.filter((x): x is string => typeof x === "string") : [];
  if (!transcript && images.length === 0 && videos.length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }

  if (await aiReady()) {
    // Turn any video clips into still frames and treat them as extra photos.
    const frames: string[] = [];
    for (const url of videos) {
      const p = uploadUrlToPath(url);
      if (!p) continue;
      try {
        frames.push(...(await extractFramesFromFile(p, FRAMES_PER_CLIP)));
      } catch {
        /* unreadable clip, skip */
      }
    }
    const allImages = [...images, ...frames].slice(0, MAX_IMAGES);
    try {
      const issue = await scoutIssue({ transcript, images: allImages });
      return NextResponse.json({ issue, engine: frames.length ? "ollama+video" : "ollama" });
    } catch {
      /* fall through to deterministic */
    }
  }
  return NextResponse.json({ issue: deterministicIssue(transcript), engine: "fallback" });
}
