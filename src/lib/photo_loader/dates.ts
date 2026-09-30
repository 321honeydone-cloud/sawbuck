// photo_loader: work out when a photo was taken.
//
// Best source first:
//   1. EXIF DateTimeOriginal, read from the Drive API's imageMediaMetadata.time
//      so the file never has to download. Local time of the camera (Eastern).
//   2. Filename patterns. PXL_ is UTC, IMG_ is local, YYYY-MM-DD_ is date only.
//   3. Drive createdTime, the upload time. LOW confidence.
// Any date in the future is thrown out and flagged. EXIF and filename that
// disagree by more than a day: trust EXIF, flag it.

import type { Confidence, DateSource, DatedPhoto, DriveFile, PhotoFlag } from "./types";

export const EASTERN_TZ = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC offset (minutes) of Eastern time at the given UTC instant. */
function easternOffsetMinutes(utcMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Interpret a wall-clock time as Eastern and return the UTC instant (ms). */
export function easternToUtcMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes handle the DST edge: offset at the guess, then re-evaluate.
  let off = easternOffsetMinutes(guess);
  let utc = guess - off * 60000;
  off = easternOffsetMinutes(utc);
  utc = guess - off * 60000;
  return utc;
}

/** Format a UTC instant as Eastern wall-clock parts. */
export function toEastern(iso: string | number): { date: string; time: string; y: number; mo: number; d: number; h: number; mi: number } {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(h).padStart(2, "0")}:${p.minute}`,
    y: Number(p.year), mo: Number(p.month), d: Number(p.day), h, mi: Number(p.minute),
  };
}

/** Eastern calendar date (YYYY-MM-DD) of a UTC instant. */
export const easternDate = (iso: string | number): string => toEastern(iso).date;

/** Parse Drive's imageMediaMetadata.time ("2026:09:29 18:56:23") as Eastern local time. */
export function parseExifTime(exif: string | null | undefined): number | null {
  if (!exif) return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(exif.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return easternToUtcMs(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0));
}

export interface FilenameDate {
  ms: number;
  pattern: "PXL" | "IMG" | "DATE_PREFIX" | "SCREENSHOT" | "SAWBUCK";
  /** Date-only patterns carry no time of day. */
  dateOnly: boolean;
}

/** Read a date out of the filename. Returns null when no known pattern matches. */
export function parseFilenameDate(name: string): FilenameDate | null {
  const base = name.trim();
  // PXL_YYYYMMDD_HHMMSSmmm (Pixel camera): UTC.
  let m = /^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(\d{3})?/i.exec(base);
  if (m) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7] : 0);
    return Number.isFinite(ms) ? { ms, pattern: "PXL", dateOnly: false } : null;
  }
  // IMG_YYYYMMDD_HHMMSS (Samsung and most Android): local time.
  m = /^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i.exec(base);
  if (m) return { ms: easternToUtcMs(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]), pattern: "IMG", dateOnly: false };
  // Screenshot_YYYYMMDD-HHMMSS: local time.
  m = /^Screenshot_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/i.exec(base);
  if (m) return { ms: easternToUtcMs(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]), pattern: "SCREENSHOT", dateOnly: false };
  // SawBUCK's own naming: YYYY-MM-DD_HHMM_##.jpg (Eastern).
  m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_\d{2}\b/.exec(base);
  if (m) return { ms: easternToUtcMs(+m[1], +m[2], +m[3], +m[4], +m[5]), pattern: "SAWBUCK", dateOnly: false };
  // YYYY-MM-DD_* : date only, taken as noon Eastern so it sorts inside its day.
  m = /^(\d{4})-(\d{2})-(\d{2})[_\- ]/.exec(base);
  if (m) return { ms: easternToUtcMs(+m[1], +m[2], +m[3], 12, 0, 0), pattern: "DATE_PREFIX", dateOnly: true };
  return null;
}

const BA_PREFIX = /^BA_/i;

/** Should this file be left in the folder but never treated as a quote photo? */
export function skipReasonFor(file: DriveFile, parentName?: string | null): string | null {
  if (BA_PREFIX.test(file.name)) return "before/after composite (BA_)";
  if (parentName && parentName.toLowerCase() === "small") return "Small copy (used for gallery only)";
  if (!/^image\//.test(file.mimeType)) return "not an image";
  return null;
}

/**
 * Work out the best date for one photo.
 * `folderDate` is the YYYY-MM-DD of a date folder the file sits in, which wins over everything.
 */
export function datePhoto(file: DriveFile, opts: { now?: number; folderDate?: string | null; parentName?: string | null } = {}): DatedPhoto {
  const now = opts.now ?? Date.now();
  const flags: PhotoFlag[] = [];
  const skip = skipReasonFor(file, opts.parentName);
  if (skip) {
    return { file, takenAt: null, source: null, confidence: "low", flags, skipped: true, skipReason: skip };
  }

  const exifMs = parseExifTime(file.exifTime);
  const fname = parseFilenameDate(file.name);
  const uploadMs = Date.parse(file.createdTime);

  let chosen: { ms: number; source: DateSource; confidence: Confidence } | null = null;

  const isFuture = (ms: number) => ms > now + 60 * 60 * 1000; // an hour of clock slack

  if (exifMs != null && !isFuture(exifMs)) {
    chosen = { ms: exifMs, source: "exif", confidence: "high" };
    if (fname && Math.abs(fname.ms - exifMs) > DAY_MS) {
      flags.push({
        kind: "exif_filename_disagree",
        detail: `EXIF says ${easternDate(exifMs)}, filename says ${easternDate(fname.ms)}. Trusting EXIF.`,
      });
    }
  } else {
    if (exifMs != null && isFuture(exifMs)) {
      flags.push({ kind: "future_date", detail: `EXIF date ${easternDate(exifMs)} is in the future, ignored.` });
    }
    if (fname && !isFuture(fname.ms)) {
      chosen = { ms: fname.ms, source: "filename", confidence: "medium" };
    } else if (fname && isFuture(fname.ms)) {
      flags.push({ kind: "future_date", detail: `Filename date ${easternDate(fname.ms)} is in the future. Uploaded ${easternDate(uploadMs)}.` });
    }
  }

  if (!chosen) {
    if (Number.isFinite(uploadMs)) {
      chosen = { ms: uploadMs, source: "upload", confidence: "low" };
      flags.push({ kind: "low_confidence", detail: "No EXIF or filename date. Using the Drive upload time." });
    } else {
      flags.push({ kind: "no_date", detail: "No usable date at all." });
    }
  }

  // A date folder pins the round regardless of what the photo itself says.
  if (opts.folderDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.folderDate)) {
    const [y, mo, d] = opts.folderDate.split("-").map(Number);
    const folderMs = easternToUtcMs(y, mo, d, 12, 0, 0);
    // Keep the photo's own time of day when it falls on that day, so rounds sort right.
    const ms = chosen && easternDate(chosen.ms) === opts.folderDate ? chosen.ms : folderMs;
    return { file, takenAt: new Date(ms).toISOString(), source: "date_folder", confidence: "high", flags };
  }

  return {
    file,
    takenAt: chosen ? new Date(chosen.ms).toISOString() : null,
    source: chosen?.source ?? null,
    confidence: chosen?.confidence ?? "low",
    flags,
  };
}

/** Confidence dot color the gallery shows. */
export const confidenceColor = (c: Confidence): "green" | "yellow" | "red" =>
  c === "high" ? "green" : c === "medium" ? "yellow" : "red";

/** SawBUCK's own filename for a photo it saves: YYYY-MM-DD_HHMM_##.jpg (Eastern). */
export function sawbuckPhotoName(takenAtIso: string | number, index: number, ext = "jpg"): string {
  const e = toEastern(takenAtIso);
  return `${e.date}_${e.time.replace(":", "")}_${String(index).padStart(2, "0")}.${ext}`;
}
