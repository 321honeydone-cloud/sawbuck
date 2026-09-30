// GET /api/photos/thumb/<driveFileId>?edge=480
// Streams a resized rendition of a Drive photo for the gallery, so the browser
// never needs Drive credentials and never downloads a 7 MB original.
import { NextResponse } from "next/server";
import { downloadResized, driveConfigured, getFile } from "@/lib/photo_loader/drive";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  if (!driveConfigured()) return NextResponse.json({ error: "drive_not_configured" }, { status: 503 });
  const { fileId } = await ctx.params;
  const edge = Math.min(2048, Math.max(64, Number(new URL(req.url).searchParams.get("edge")) || 480));
  try {
    const file = await getFile(fileId);
    const { bytes, mimeType } = await downloadResized(file, edge);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": mimeType, "cache-control": "private, max-age=3600" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
