// POST /api/photos/sort { propertyFolderId, moves: [{ date, fileIds }] }
// The one-tap "Sort photos" action: loose PM photos move into a date folder.
// This is the only place SawBUCK moves anything in Drive. Never renames, never deletes.
import { NextResponse } from "next/server";
import { sortLoosePhotos } from "@/lib/photo_loader/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { propertyFolderId?: string; moves?: { date?: string; fileIds?: string[] }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const moves = (body.moves ?? []).filter((m) => m.date && Array.isArray(m.fileIds) && m.fileIds.length).map((m) => ({ date: m.date!, fileIds: m.fileIds! }));
  if (!body.propertyFolderId || !moves.length) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  try {
    const out = await sortLoosePhotos(body.propertyFolderId, moves);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
