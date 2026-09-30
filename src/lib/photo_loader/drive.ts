// photo_loader: thin Google Drive v3 client. Server-only, no SDK.
//
// Two ways to sign in, checked in this order:
//   1. GOOGLE_SERVICE_ACCOUNT_JSON: a service account key (JSON string or a
//      path to the file). Share "1. Clients" with the service account email.
//   2. GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET +
//      GOOGLE_OAUTH_REFRESH_TOKEN: Manny's own Google account.
// Reads never change anything. The only writes are createFolder and moveFile,
// and both are reached only from a tap in the UI (Sort photos card).

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DriveFile, DriveFolder } from "./types";

export const CLIENTS_ROOT_ID = process.env.DRIVE_CLIENTS_ROOT_ID || "16ir823EsHr8XcFjxJcfacNZ36wPczak5"; // "1. Clients"
const FOLDER_MIME = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS = "id,name,mimeType,parents,createdTime,modifiedTime,size,imageMediaMetadata(time),thumbnailLink,webViewLink";

let cachedToken: { token: string; exp: number } | null = null;

/** Is Drive access configured at all? The UI shows a quiet note when it is not. */
export function driveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REFRESH_TOKEN)
  );
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function serviceAccountToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!;
  const json = raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8");
  const sa = JSON.parse(json) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(sa.private_key));
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Drive service account sign-in failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function oauthToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Drive OAuth refresh failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

export async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return serviceAccountToken();
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) return oauthToken();
  throw new Error("Google Drive is not configured (set GOOGLE_SERVICE_ACCOUNT_JSON or the GOOGLE_OAUTH_* vars).");
}

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive ${init.method || "GET"} ${path} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res;
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  createdTime: string;
  modifiedTime?: string;
  size?: string;
  imageMediaMetadata?: { time?: string };
  thumbnailLink?: string;
  webViewLink?: string;
}

const toFile = (f: RawFile): DriveFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  parentId: f.parents?.[0] ?? null,
  createdTime: f.createdTime,
  modifiedTime: f.modifiedTime,
  size: f.size != null ? Number(f.size) : undefined,
  exifTime: f.imageMediaMetadata?.time ?? null,
  thumbnailLink: f.thumbnailLink ?? null,
  webViewLink: f.webViewLink ?? null,
});

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Every non-trashed child of a folder (files and folders), all pages. */
export async function listChildren(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${q(folderId)}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(`/files?${params}`);
    const data = (await res.json()) as { files: RawFile[]; nextPageToken?: string };
    out.push(...data.files.map(toFile));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

export const isFolder = (f: DriveFile): boolean => f.mimeType === FOLDER_MIME;
export const asFolder = (f: DriveFile): DriveFolder => ({ id: f.id, name: f.name, parentId: f.parentId });

/** Subfolders of a folder. */
export async function listSubfolders(folderId: string): Promise<DriveFolder[]> {
  return (await listChildren(folderId)).filter(isFolder).map(asFolder);
}

/** Find a direct child folder by EXACT name (case-sensitive first, then case-insensitive). */
export async function findChildFolder(parentId: string, name: string): Promise<DriveFolder | null> {
  const subs = await listSubfolders(parentId);
  return subs.find((f) => f.name === name) ?? subs.find((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
}

/** Create a folder. Only ever called from a UI tap. */
export async function createFolder(parentId: string, name: string): Promise<DriveFolder> {
  const res = await driveFetch(`/files?supportsAllDrives=true&fields=id,name,parents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  const data = (await res.json()) as { id: string; name: string; parents?: string[] };
  return { id: data.id, name: data.name, parentId: data.parents?.[0] ?? parentId };
}

/** Move a file between folders. Only ever called from a UI tap. Never renames, never deletes. */
export async function moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
  const params = new URLSearchParams({ addParents: toFolderId, removeParents: fromFolderId, supportsAllDrives: "true", fields: "id,parents" });
  await driveFetch(`/files/${encodeURIComponent(fileId)}?${params}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
}

/** Fetch a file's bytes (the Small copy for uploads, or an original when no Small exists). */
export async function downloadFile(fileId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const res = await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, mimeType: res.headers.get("content-type") || "image/jpeg" };
}

/**
 * A resized JPEG rendition via Drive's thumbnail service (no full download).
 * `edge` is the long edge in pixels. Falls back to the full file when the
 * thumbnail link is missing.
 */
export async function downloadResized(file: DriveFile, edge = 1568): Promise<{ bytes: Buffer; mimeType: string }> {
  if (file.thumbnailLink) {
    const url = file.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${edge}`);
    try {
      const res = await driveFetch(url);
      return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") || "image/jpeg" };
    } catch {
      /* thumbnail links expire; fall through to the real file */
    }
  }
  return downloadFile(file.id);
}

/** One file's metadata (fresh thumbnailLink included). */
export async function getFile(fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" });
  const res = await driveFetch(`/files/${encodeURIComponent(fileId)}?${params}`);
  return toFile((await res.json()) as RawFile);
}
