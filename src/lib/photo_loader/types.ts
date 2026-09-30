// photo_loader: shared types.
//
// The loader reads the 321honeydone Google Drive ("1. Clients") and works out
// which photos belong to which quote. Everything here is plain data so the
// matching rules (address.ts, dates.ts, rounds.ts) can be unit-tested without
// Drive or Jobber in the loop.

/** Where a photo's date came from. Best source first. */
export type DateSource = "date_folder" | "exif" | "filename" | "upload";

/** Green = date folder or EXIF, yellow = filename, red = upload time. */
export type Confidence = "high" | "medium" | "low";

export type RoundRole = "Before" | "Progress" | "After";

/** A file as the Drive API reports it. Only the fields the loader reads. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parentId: string | null;
  createdTime: string; // RFC 3339 (upload time)
  modifiedTime?: string;
  size?: number;
  /** imageMediaMetadata.time from the Drive API, "YYYY:MM:DD HH:MM:SS" (EXIF DateTimeOriginal). */
  exifTime?: string | null;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
}

export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
}

/** A photo with its best date worked out. */
export interface DatedPhoto {
  file: DriveFile;
  /** Best date as a UTC ISO string, or null when nothing usable was found. */
  takenAt: string | null;
  source: DateSource | null;
  confidence: Confidence;
  flags: PhotoFlag[];
  /** Small/ copy to show and upload, when one exists. */
  smallFile?: DriveFile | null;
  /** True for BA_ composites and Small/ copies: stays in the folder, never a quote photo. */
  skipped?: boolean;
  skipReason?: string;
}

export type PhotoFlag =
  | { kind: "future_date"; detail: string }
  | { kind: "exif_filename_disagree"; detail: string }
  | { kind: "low_confidence"; detail: string }
  | { kind: "no_date"; detail: string }
  | { kind: "duplicate"; detail: string };

/** A group of photos taken together (gap of more than 12 hours starts a new round). */
export interface Round {
  /** Stable key derived from the file ids, used to persist a manual assignment. */
  key: string;
  startedAt: string; // ISO
  endedAt: string; // ISO
  photos: DatedPhoto[];
  /** Worst confidence in the round (what the dot shows). */
  confidence: Confidence;
  /** Date folder the round came from, when the client uses date folders. */
  dateFolder?: { id: string; name: string; date: string } | null;
}

/** One quote or job on a property, the window a round can land in. */
export interface QuoteWindow {
  id: string; // SawBUCK estimate id or Jobber quote id
  label: string;
  sawbuckEstimateId?: string | null;
  jobberQuoteNumber?: string | null;
  createdAt: string; // ISO
  approvedAt?: string | null;
  jobCompletedAt?: string | null;
  /** Date folder name (YYYY-MM-DD) this quote is pinned to, when known. */
  dateFolder?: string | null;
}

export type MatchReason =
  | "date_folder"
  | "before_created_after_round"
  | "before_between_created_and_approval"
  | "after_approval"
  | "manual";

export interface MatchedRound extends Round {
  quoteId: string | null;
  role: RoundRole | null;
  reason: MatchReason | null;
  /** Why it landed in Needs you, when it did. */
  needsYou?: string | null;
}

/** Client folder layout as found on Drive. */
export type FolderLayout = "pm" | "flat";

export interface ResolvedFolder {
  layout: FolderLayout;
  clientFolder: DriveFolder;
  /** PM only: the address subfolder that matched the quote's property. */
  propertyFolder?: DriveFolder | null;
  /** PM only: date subfolders under the property folder. */
  dateFolders: { folder: DriveFolder; date: string }[];
  /** PM only: the date folder chosen for this quote (if any). */
  chosenDateFolder?: { folder: DriveFolder; date: string } | null;
  /** PM only: photos sitting loose in the address folder (not in a date folder). */
  looseCount: number;
}

export type NeedsYouCard =
  | {
      kind: "pick_quote";
      title: string;
      detail: string;
      round: MatchedRound;
      choices: { quoteId: string; label: string }[];
    }
  | {
      kind: "sort_photos";
      title: string;
      detail: string;
      propertyFolderId: string;
      rounds: { round: MatchedRound; suggestedQuoteId: string | null; suggestedDate: string }[];
    }
  | { kind: "no_client_folder"; title: string; detail: string }
  | { kind: "no_property_folder"; title: string; detail: string; candidates: string[] }
  | { kind: "flat_folder_many_properties"; title: string; detail: string }
  | { kind: "flagged"; title: string; detail: string; fileIds: string[] };

export interface PhotoLoadResult {
  ok: boolean;
  /** Human-readable reason when ok is false (no Drive creds, no folder...). */
  error?: string | null;
  configured: boolean;
  quoteId: string;
  folder?: ResolvedFolder | null;
  quotes: QuoteWindow[];
  rounds: MatchedRound[];
  needsYou: NeedsYouCard[];
  /** Skipped files (BA_ composites, Small copies), listed so nothing looks lost. */
  skipped: { id: string; name: string; reason: string }[];
  /** ISO time the result was produced. */
  loadedAt: string;
}
