// Shared-brain sync endpoint. Both the local box and the Render deploy run this.
//
// POST: the caller sends ITS copy of SAWBUCK_MEMORY.md as the body. We union-merge
// it into the live copy on THIS server (no log entry is lost) and return the
// merged result, so the caller can save the same union back. One round trip and
// both sides hold the identical, combined learning log.
//
// GET: returns the live copy (handy for a manual pull).
//
// Auth is a shared secret in the SYNC_SECRET env var, sent as the x-sync-key
// header. If SYNC_SECRET is not set, the endpoint is disabled (403), so it is
// off by default and only turns on where you deliberately configure it.

import { NextResponse } from "next/server";
import { mergeIntoMemory, readMemoryRaw } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  const secret = process.env.SYNC_SECRET || "";
  if (!secret) return false;
  return req.headers.get("x-sync-key") === secret;
}

const asMarkdown = (body: string) =>
  new NextResponse(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return asMarkdown(await readMemoryRaw());
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const incoming = await req.text();
  // Guard against garbage: a real memory file always carries the log markers.
  if (!incoming || !incoming.includes("<!-- log:")) {
    return NextResponse.json({ error: "bad_memory_payload" }, { status: 400 });
  }
  await mergeIntoMemory(incoming);
  return asMarkdown(await readMemoryRaw());
}
