// photo_loader: find the Drive folder that belongs to a quote.
//
// Layouts on "1. Clients" (checked live 2026-09-30):
//   PM:        Clients / <Company> / <Street address> / <YYYY-MM-DD> / photos
//   Homeowner: Clients / <First Last> / photos   (flat, no subfolders)
// Rules: client folder by EXACT name (no near-duplicate creation), property
// folder by normalized street address (house number exact), date folder by the
// quote's created date (same date, else closest on or before within 14 days).

import { addressesMatch, looksLikeAddress, streetLine } from "./address";
import type { DriveFile, DriveFolder, FolderLayout } from "./types";

/** The slice of Drive the folder logic needs. Real one wraps drive.ts; tests use a fake. */
export interface DriveReader {
  listChildren(folderId: string): Promise<DriveFile[]>;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DATE_FOLDER_RX = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isFolderFile = (f: DriveFile) => f.mimeType === FOLDER_MIME;
export const isImage = (f: DriveFile) => /^image\//.test(f.mimeType);
export const toFolder = (f: DriveFile): DriveFolder => ({ id: f.id, name: f.name, parentId: f.parentId });

/** Exact-name client folder. Trims whitespace and ignores case, nothing fuzzier than that. */
export function findClientFolder(children: DriveFile[], clientName: string): DriveFolder | null {
  const want = clientName.trim();
  if (!want) return null;
  const folders = children.filter(isFolderFile);
  const exact = folders.find((f) => f.name === want);
  if (exact) return toFolder(exact);
  const loose = folders.filter((f) => f.name.trim().toLowerCase() === want.toLowerCase());
  return loose.length === 1 ? toFolder(loose[0]) : null;
}

/**
 * PM when the client folder holds address-looking subfolders. A folder with
 * photos sitting loose in it is flat no matter what Jobber says (that case is
 * the "flat folder, more than one property" Needs you card). The PM hint only
 * decides an empty folder, so a new PM client gets the address layout.
 */
export function detectLayout(children: DriveFile[], hint?: { isPm?: boolean | null }): FolderLayout {
  const addressFolders = children.filter((f) => isFolderFile(f) && looksLikeAddress(f.name));
  if (addressFolders.length > 0) return "pm";
  const loosePhotos = children.some((f) => !isFolderFile(f) && isImage(f));
  if (hint?.isPm && !loosePhotos) return "pm";
  return "flat";
}

/** The address subfolder for a property. Exact house number, normalized street. */
export function findPropertyFolder(children: DriveFile[], propertyAddress: string): DriveFolder | null {
  const street = streetLine(propertyAddress);
  if (!street) return null;
  const hits = children.filter((f) => isFolderFile(f) && addressesMatch(f.name, street));
  return hits.length === 1 ? toFolder(hits[0]) : null;
}

/** YYYY-MM-DD subfolders, sorted ascending. */
export function dateFolders(children: DriveFile[]): { folder: DriveFolder; date: string }[] {
  return children
    .filter((f) => isFolderFile(f) && DATE_FOLDER_RX.test(f.name.trim()))
    .map((f) => ({ folder: toFolder(f), date: f.name.trim() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The Small/ subfolder if present. */
export function smallFolder(children: DriveFile[]): DriveFolder | null {
  const f = children.find((c) => isFolderFile(c) && c.name.trim().toLowerCase() === "small");
  return f ? toFolder(f) : null;
}

/** Map each original to its Small copy by exact filename. */
export function pairSmallCopies(originals: DriveFile[], smalls: DriveFile[]): Map<string, DriveFile> {
  const byName = new Map(smalls.map((s) => [s.name.toLowerCase(), s]));
  const out = new Map<string, DriveFile>();
  for (const o of originals) {
    const s = byName.get(o.name.toLowerCase());
    if (s) out.set(o.id, s);
  }
  return out;
}
