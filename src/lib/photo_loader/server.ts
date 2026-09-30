// photo_loader: server-side glue between the pure loader and the app.
//   - loadForEstimate: DB row -> quote context -> Drive -> PhotoLoadResult
//   - assignments: Manny's manual picks, kept in AppSetting (no schema change)
//   - beforeRoundAttachments: the matched Before round as base64 Attachments
//     for the estimator (auto quote) and the Jobber push
//   - sortLoosePhotos / setUpQuoteFolder: the only Drive writes, tap-driven
// Server-only.

import { prisma } from "../db";
import type { Attachment } from "../types";
import { propertyContext } from "./context";
import { easternDate } from "./dates";
import { createFolder, downloadFile, downloadResized, driveConfigured, findChildFolder, listChildren, moveFile, CLIENTS_ROOT_ID } from "./drive";
import { findClientFolder, findPropertyFolder, type DriveReader } from "./folders";
import { loadPhotosForQuote } from "./loader";
import { streetLine } from "./address";
import type { DatedPhoto, MatchedRound, PhotoLoadResult, RoundRole } from "./types";

const ASSIGN_PREFIX = "photo_assign:";

export const realDrive: DriveReader = { listChildren };

/** Manual round -> quote picks. */
export async function readAssignments(): Promise<Record<string, { quoteId: string; role?: RoundRole | null }>> {
  const out: Record<string, { quoteId: string; role?: RoundRole | null }> = {};
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: ASSIGN_PREFIX } } });
    for (const r of rows) {
      try {
        out[r.key.slice(ASSIGN_PREFIX.length)] = JSON.parse(r.value) as { quoteId: string; role?: RoundRole | null };
      } catch {
        /* skip a bad row */
      }
    }
  } catch {
    /* table missing on first boot: no picks yet */
  }
  return out;
}

export async function writeAssignment(roundKey: string, quoteId: string, role?: RoundRole | null): Promise<void> {
  const key = ASSIGN_PREFIX + roundKey;
  const value = JSON.stringify({ quoteId, role: role ?? null });
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function clearAssignment(roundKey: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: ASSIGN_PREFIX + roundKey } });
}

/** A result that says "not configured" instead of throwing, so the UI stays quiet. */
function unconfigured(quoteId: string): PhotoLoadResult {
  return { ok: false, configured: false, error: "Google Drive is not connected (set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_OAUTH_* in the environment).", quoteId, quotes: [], rounds: [], needsYou: [], skipped: [], loadedAt: new Date().toISOString() };
}

/** Load the photos for one SawBUCK estimate. */
export async function loadForEstimate(estimateId: string): Promise<PhotoLoadResult> {
  if (!driveConfigured()) return unconfigured(estimateId);
  const row = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, data: true },
  });
  if (!row) return { ...unconfigured(estimateId), configured: true, error: "Estimate not found." };
  let parsed: { clientName?: string | null; clientAddress?: string | null } = {};
  try {
    parsed = JSON.parse(row.data || "{}");
  } catch {
    parsed = {};
  }
  const ctx = await propertyContext(row);
  const assignments = await readAssignments();
  try {
    return await loadPhotosForQuote(realDrive, {
      quoteId: row.id,
      clientName: parsed.clientName,
      propertyAddress: parsed.clientAddress,
      quotes: ctx.quotes,
      isPm: ctx.jobber?.isCompany ?? null,
      propertyCount: ctx.jobber?.propertyCount ?? null,
      assignments,
    });
  } catch (err) {
    return { ...unconfigured(estimateId), configured: true, error: `Drive read failed: ${(err as Error).message}` };
  }
}

/** Rounds that belong to this quote, in date order. */
export function roundsFor(result: PhotoLoadResult, role?: RoundRole): MatchedRound[] {
  return result.rounds
    .filter((r) => r.quoteId === result.quoteId && (!role || r.role === role))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** Prefer the Small copy; otherwise a resized rendition of the original. */
async function photoBytes(p: DatedPhoto, edge: number): Promise<{ bytes: Buffer; mimeType: string }> {
  if (p.smallFile) return downloadFile(p.smallFile.id);
  return downloadResized(p.file, edge);
}

/**
 * The matched Before round as estimator attachments (base64). Used by the auto
 * quote path and by the Jobber push, which only ever attaches Before photos.
 */
export async function beforeRoundAttachments(estimateId: string, max = 10, edge = 1568): Promise<{ attachments: Attachment[]; result: PhotoLoadResult }> {
  const result = await loadForEstimate(estimateId);
  const before = roundsFor(result, "Before");
  const photos = before.flatMap((r) => r.photos).filter((p) => !p.skipped).slice(0, max);
  const attachments: Attachment[] = [];
  for (const p of photos) {
    try {
      const { bytes, mimeType } = await photoBytes(p, edge);
      attachments.push({ name: p.file.name, kind: "image", mediaType: mimeType.startsWith("image/") ? mimeType : "image/jpeg", data: bytes.toString("base64") });
    } catch {
      /* one bad download never blocks the rest */
    }
  }
  return { attachments, result };
}

/**
 * Sort photos (one tap): move the given files from the address folder into a
 * YYYY-MM-DD date folder, creating it if missing. Never renames, never deletes.
 */
export async function sortLoosePhotos(propertyFolderId: string, moves: { date: string; fileIds: string[] }[]): Promise<{ moved: number; folders: string[] }> {
  let moved = 0;
  const folders: string[] = [];
  for (const m of moves) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) throw new Error(`Bad date folder name: ${m.date}`);
    let target = await findChildFolder(propertyFolderId, m.date);
    if (!target) {
      target = await createFolder(propertyFolderId, m.date);
      folders.push(m.date);
    }
    for (const id of m.fileIds) {
      await moveFile(id, propertyFolderId, target.id);
      moved += 1;
    }
  }
  return { moved, folders };
}

/**
 * Set up the folder for a quote (one tap): PM clients get the address subfolder
 * and a date subfolder named for the quote's created date (Eastern). Returns
 * what was created. Homeowners keep a flat folder, so nothing is created.
 */
export async function setUpQuoteFolder(estimateId: string): Promise<{ created: string[]; folderId: string | null }> {
  const row = await prisma.estimate.findUnique({ where: { id: estimateId }, select: { createdAt: true, data: true } });
  if (!row) throw new Error("Estimate not found");
  const parsed = JSON.parse(row.data || "{}") as { clientName?: string | null; clientAddress?: string | null };
  const clientName = (parsed.clientName ?? "").trim();
  const address = streetLine(parsed.clientAddress ?? "");
  if (!clientName || !address) throw new Error("Client name and property address are both needed first.");
  const rootChildren = await listChildren(CLIENTS_ROOT_ID);
  const client = findClientFolder(rootChildren, clientName);
  if (!client) throw new Error(`No client folder named "${clientName}". Create it in Drive first (SawBUCK never creates near-duplicates).`);
  const created: string[] = [];
  const clientChildren = await listChildren(client.id);
  let prop = findPropertyFolder(clientChildren, address);
  if (!prop) {
    prop = await createFolder(client.id, address);
    created.push(address);
  }
  const date = easternDate(row.createdAt.toISOString());
  let df = await findChildFolder(prop.id, date);
  if (!df) {
    df = await createFolder(prop.id, date);
    created.push(`${address}/${date}`);
  }
  return { created, folderId: df.id };
}
