// POST /api/photos/setup { estimateId }
// One tap: create the PM address subfolder and the quote's date folder.
import { NextResponse } from "next/server";
import { setUpQuoteFolder } from "@/lib/photo_loader/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { estimateId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.estimateId) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  try {
    const out = await setUpQuoteFolder(body.estimateId);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
