import { type NextRequest } from "next/server";
import { stat, readFile } from "fs/promises";
import path from "path";
import { uploadsRoot } from "@/lib/uploads";

export const runtime = "nodejs";

// Serve inspection media (photos + video) that /api/upload wrote to
// public/uploads at runtime. Next's static handler does not reliably serve
// files added after the server started, so we stream them from disk here.
// A rewrite in next.config maps /uploads/* to this route, so both old stored
// URLs and new uploads resolve through the same path.

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

const UPLOAD_ROOT = uploadsRoot();

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;

  // Reject empty, traversal, or separator-bearing segments.
  if (
    !segments?.length ||
    segments.some((s) => !s || s === "." || s === ".." || s.includes("/") || s.includes("\\"))
  ) {
    return new Response("bad request", { status: 400 });
  }

  const filePath = path.join(UPLOAD_ROOT, ...segments);
  if (filePath !== UPLOAD_ROOT && !filePath.startsWith(UPLOAD_ROOT + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!info.isFile()) return new Response("not found", { status: 404 });

  const ext = (segments[segments.length - 1].split(".").pop() ?? "").toLowerCase();
  const type = CONTENT_TYPE[ext] ?? "application/octet-stream";
  const buf = await readFile(filePath);

  // Honor range requests so video scrubbing works.
  const range = req.headers.get("range");
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : info.size - 1;
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end < info.size) {
      const slice = new Uint8Array(buf.subarray(start, end + 1));
      return new Response(slice, {
        status: 206,
        headers: {
          "content-type": type,
          "content-length": String(slice.length),
          "content-range": `bytes ${start}-${end}/${info.size}`,
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": type,
      "content-length": String(info.size),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
