// photo_loader: the orchestrator. Given a quote, find its Drive folder, date
// every photo, group rounds, match them to quotes, and build the Needs you
// cards. Pure with respect to Drive (takes a DriveReader) so it can be run
// against a fake built from real folder listings.

import { CLIENTS_ROOT_ID } from "./drive";
import { datePhoto, easternDate } from "./dates";
import { dateFolders, detectLayout, findClientFolder, findPropertyFolder, isFolderFile, isImage, pairSmallCopies, smallFolder, type DriveReader } from "./folders";
import { dedupePhotos, groupRounds, matchRounds, pickDateFolder } from "./rounds";
import { streetLine } from "./address";
import type { DatedPhoto, DriveFile, DriveFolder, MatchedRound, NeedsYouCard, PhotoLoadResult, QuoteWindow, ResolvedFolder, RoundRole } from "./types";

export interface LoadInput {
  quoteId: string;
  clientName: string | null | undefined;
  /** Property address on the quote (street line or full address). */
  propertyAddress: string | null | undefined;
  /** Every quote window on the property, including this one (see context.ts). */
  quotes: QuoteWindow[];
  /** Jobber hints when available. */
  isPm?: boolean | null;
  propertyCount?: number | null;
  /** Manual picks: round key -> quote. */
  assignments?: Record<string, { quoteId: string; role?: RoundRole | null }>;
  now?: number;
  rootId?: string;
}

const card = (c: NeedsYouCard) => c;

/** Date every image in a folder, pairing Small copies and honoring a date folder. */
async function datedPhotosIn(
  reader: DriveReader,
  folder: DriveFolder,
  opts: { folderDate?: string | null; now: number }
): Promise<{ photos: DatedPhoto[]; children: DriveFile[] }> {
  const children = await reader.listChildren(folder.id);
  const originals = children.filter((f) => !isFolderFile(f) && isImage(f));
  const small = smallFolder(children);
  const smalls = small ? (await reader.listChildren(small.id)).filter(isImage) : [];
  const pairs = pairSmallCopies(originals, smalls);
  const photos = originals.map((f) => ({ ...datePhoto(f, { now: opts.now, folderDate: opts.folderDate, parentName: folder.name }), smallFile: pairs.get(f.id) ?? null }));
  return { photos: dedupePhotos(photos), children };
}

/** Photos that never made it into a round (future dates, no date at all). */
function flaggedCard(photos: DatedPhoto[]): NeedsYouCard | null {
  const bad = photos.filter((p) => !p.skipped && !p.takenAt);
  const future = photos.filter((p) => !p.skipped && p.flags.some((f) => f.kind === "future_date"));
  const all = [...new Map([...bad, ...future].map((p) => [p.file.id, p])).values()];
  if (!all.length) return null;
  return card({
    kind: "flagged",
    title: `${all.length} photo${all.length === 1 ? "" : "s"} with a bad date`,
    detail: all.map((p) => `${p.file.name}: ${p.flags.map((f) => f.detail).join(" ") || "no usable date"}`).join("\n"),
    fileIds: all.map((p) => p.file.id),
  });
}

/** Load the photos that belong to one quote. Never writes to Drive. */
export async function loadPhotosForQuote(reader: DriveReader, input: LoadInput): Promise<PhotoLoadResult> {
  const now = input.now ?? Date.now();
  const rootId = input.rootId ?? CLIENTS_ROOT_ID;
  const base: PhotoLoadResult = {
    ok: false,
    configured: true,
    quoteId: input.quoteId,
    folder: null,
    quotes: input.quotes,
    rounds: [],
    needsYou: [],
    skipped: [],
    loadedAt: new Date(now).toISOString(),
  };

  const clientName = (input.clientName ?? "").trim();
  if (!clientName) return { ...base, error: "No client name on this quote yet." };

  // 1. Client folder by exact name. No match: Needs you, never create a near duplicate.
  const rootChildren = await reader.listChildren(rootId);
  const clientFolder = findClientFolder(rootChildren, clientName);
  if (!clientFolder) {
    const near = rootChildren
      .filter(isFolderFile)
      .map((f) => f.name)
      .filter((n) => n.toLowerCase().includes(clientName.split(" ")[0].toLowerCase()))
      .slice(0, 5);
    return {
      ...base,
      ok: true,
      needsYou: [
        card({
          kind: "no_client_folder",
          title: `No Drive folder named "${clientName}"`,
          detail: near.length ? `Close names in 1. Clients: ${near.join(", ")}. Rename the folder or the client so they match exactly.` : "Nothing close in 1. Clients. Create the folder in Drive, or fix the client name on this quote.",
        }),
      ],
    };
  }

  const clientChildren = await reader.listChildren(clientFolder.id);
  const isPmHint = Boolean(input.isPm) || (input.propertyCount ?? 0) > 1;
  const layout = detectLayout(clientChildren, { isPm: isPmHint });
  const quotes = input.quotes.map((q) => ({ ...q }));
  const needsYou: NeedsYouCard[] = [];
  const skipped: PhotoLoadResult["skipped"] = [];
  const rounds: MatchedRound[] = [];
  const noteSkips = (photos: DatedPhoto[]) => {
    for (const p of photos) if (p.skipped) skipped.push({ id: p.file.id, name: p.file.name, reason: p.skipReason ?? "skipped" });
  };

  if (layout === "flat") {
    const folder: ResolvedFolder = { layout, clientFolder, propertyFolder: null, dateFolders: [], chosenDateFolder: null, looseCount: 0 };
    // A flat folder is only valid when the client has one property in Jobber.
    if ((input.propertyCount ?? 1) > 1) {
      const { photos } = await datedPhotosIn(reader, clientFolder, { now });
      noteSkips(photos);
      const grouped = groupRounds(photos);
      const matched = matchRounds(grouped, quotes, { now, assignments: input.assignments });
      for (const r of matched) {
        if (r.reason !== "manual") rounds.push({ ...r, quoteId: null, role: null, reason: null, needsYou: "Flat folder but this client has more than one property in Jobber." });
        else rounds.push(r);
      }
      needsYou.push(card({ kind: "flat_folder_many_properties", title: `${clientName} has more than one property`, detail: "The Drive folder is flat (no address subfolders), so SawBUCK cannot tell which property these photos belong to. Pick per round below, or add address subfolders in Drive." }));
      pushPickCards(rounds, quotes, needsYou);
      const fc = flaggedCard(photos);
      if (fc) needsYou.push(fc);
      return { ...base, ok: true, folder, quotes, rounds, needsYou, skipped };
    }
    const { photos } = await datedPhotosIn(reader, clientFolder, { now });
    noteSkips(photos);
    folder.looseCount = photos.filter((p) => !p.skipped).length;
    rounds.push(...matchRounds(groupRounds(photos), quotes, { now, assignments: input.assignments }));
    pushPickCards(rounds, quotes, needsYou);
    const fc = flaggedCard(photos);
    if (fc) needsYou.push(fc);
    return { ...base, ok: true, folder, quotes, rounds, needsYou, skipped };
  }

  // PM layout: Clients / Company / Address / YYYY-MM-DD.
  const address = streetLine(input.propertyAddress ?? "");
  const addressFolders = clientChildren.filter(isFolderFile).map((f) => f.name);
  if (!address) {
    return {
      ...base,
      ok: true,
      folder: { layout, clientFolder, propertyFolder: null, dateFolders: [], chosenDateFolder: null, looseCount: 0 },
      needsYou: [card({ kind: "no_property_folder", title: "No property address on this quote", detail: `${clientName} is a property manager. Add the street address to the quote so SawBUCK can pick the right folder.`, candidates: addressFolders })],
      skipped,
    };
  }
  const propertyFolder = findPropertyFolder(clientChildren, address);
  if (!propertyFolder) {
    return {
      ...base,
      ok: true,
      folder: { layout, clientFolder, propertyFolder: null, dateFolders: [], chosenDateFolder: null, looseCount: 0 },
      needsYou: [card({ kind: "no_property_folder", title: `No folder for ${address}`, detail: addressFolders.length ? `Address folders under ${clientName}: ${addressFolders.join(", ")}. House number and unit must match exactly.` : `No address folders under ${clientName} yet. Tap "Set up folder" to create one.`, candidates: addressFolders })],
      skipped,
    };
  }

  const propChildren = await reader.listChildren(propertyFolder.id);
  const dfs = dateFolders(propChildren);
  // Pin each quote to the date folder that matches its created date.
  for (const q of quotes) {
    const pick = pickDateFolder(dfs, q.createdAt);
    q.dateFolder = pick?.date ?? null;
  }
  const me = quotes.find((q) => q.id === input.quoteId) ?? null;
  const chosen = me?.dateFolder ? dfs.find((d) => d.date === me.dateFolder) ?? null : null;

  // Loose photos in the address folder (the Stalwart case today).
  const loose = await datedPhotosIn(reader, propertyFolder, { now });
  noteSkips(loose.photos);
  const looseRounds = matchRounds(groupRounds(loose.photos), quotes, { now, assignments: input.assignments });
  rounds.push(...looseRounds);
  const folder: ResolvedFolder = { layout, clientFolder, propertyFolder, dateFolders: dfs, chosenDateFolder: chosen, looseCount: loose.photos.filter((p) => !p.skipped).length };

  // Each date folder is its own set of rounds, pinned to the quote by the folder date.
  for (const df of dfs) {
    const inFolder = await datedPhotosIn(reader, df.folder, { now, folderDate: df.date });
    noteSkips(inFolder.photos);
    const grouped = groupRounds(inFolder.photos, { id: df.folder.id, name: df.folder.name, date: df.date });
    rounds.push(...matchRounds(grouped, quotes, { now, assignments: input.assignments }));
  }

  // Sort photos card: loose rounds that should live in a date folder. One tap moves them.
  if (looseRounds.length) {
    needsYou.push(
      card({
        kind: "sort_photos",
        title: `Sort ${folder.looseCount} loose photo${folder.looseCount === 1 ? "" : "s"} in ${propertyFolder.name}`,
        detail: "These sit in the address folder with no date folder. SawBUCK found the rounds below and the quote it thinks each goes with. Nothing moves until you tap.",
        propertyFolderId: propertyFolder.id,
        rounds: looseRounds.map((r) => ({
          round: r,
          suggestedQuoteId: r.quoteId,
          // Date folder name = the date of the first photo round for that quote, else the quote created date.
          suggestedDate: suggestedFolderDate(r, quotes, looseRounds),
        })),
      })
    );
  }
  pushPickCards(rounds, quotes, needsYou);
  const fc = flaggedCard(loose.photos);
  if (fc) needsYou.push(fc);

  return { ...base, ok: true, folder, quotes, rounds, needsYou, skipped };
}

/** The YYYY-MM-DD a round's date folder should carry. */
export function suggestedFolderDate(r: MatchedRound, quotes: QuoteWindow[], all: MatchedRound[]): string {
  if (r.quoteId) {
    const q = quotes.find((x) => x.id === r.quoteId);
    if (q?.dateFolder) return q.dateFolder;
    // First round for that quote sets the folder date (before rounds first).
    const mine = all.filter((x) => x.quoteId === r.quoteId).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    if (mine.length) return easternDate(mine[0].startedAt);
    if (q) return easternDate(q.createdAt);
  }
  return easternDate(r.startedAt);
}

/** "Pick the quote for these photos" for every round that did not match cleanly. */
function pushPickCards(rounds: MatchedRound[], quotes: QuoteWindow[], needsYou: NeedsYouCard[]) {
  for (const r of rounds) {
    if (r.quoteId || !r.needsYou) continue;
    needsYou.push(
      card({
        kind: "pick_quote",
        title: `Pick the quote for ${r.photos.length} photo${r.photos.length === 1 ? "" : "s"} from ${easternDate(r.startedAt)}`,
        detail: r.needsYou,
        round: r,
        choices: quotes.map((q) => ({ quoteId: q.id, label: q.label })),
      })
    );
  }
}
