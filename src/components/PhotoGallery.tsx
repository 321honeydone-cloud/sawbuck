"use client";

// Job photos for the open quote, straight from the client's Drive folder.
// Grouped by round, each labeled with its date and Before / Progress / After,
// with a confidence dot (green = date folder or EXIF, yellow = filename,
// red = upload time). Needs you cards sit on top: "Pick the quote for these
// photos" and "Sort photos", each a one-tap choice. Nothing in Drive moves
// without one of those taps.

import { useEffect, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import { confidenceColor, easternDate, toEastern } from "@/lib/photo_loader/dates";
import type { MatchedRound, NeedsYouCard, PhotoLoadResult, RoundRole } from "@/lib/photo_loader/types";

const DOT: Record<"green" | "yellow" | "red", string> = {
  green: "bg-gain",
  yellow: "bg-yellow",
  red: "bg-danger",
};

const ROLE_TONE: Record<RoundRole, string> = {
  Before: "border-brand/60 bg-brand/10 text-brand",
  Progress: "border-flag/60 bg-flag/10 text-flag",
  After: "border-gain/60 bg-gain/10 text-gain",
};

export const thumbUrl = (fileId: string, edge = 320) => `/api/photos/thumb/${encodeURIComponent(fileId)}?edge=${edge}`;

/** The rounds that belong to the open quote, oldest first. */
export function roundsForQuote(result: PhotoLoadResult | null): MatchedRound[] {
  if (!result) return [];
  return result.rounds.filter((r) => r.quoteId === result.quoteId).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

export default function PhotoGallery() {
  const estimateId = useEstimateStore((s) => s.estimate.id);
  const clientName = useEstimateStore((s) => s.estimate.clientName ?? "");
  const clientAddress = useEstimateStore((s) => s.estimate.clientAddress ?? "");
  const photos = useEstimateStore((s) => s.photos);
  const loading = useEstimateStore((s) => s.photosLoading);
  const loadPhotos = useEstimateStore((s) => s.loadPhotos);
  const [open, setOpen] = useState(true);

  // Load when the quote opens and again when the client or address changes.
  useEffect(() => {
    if (!clientName.trim()) return;
    void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId, clientName, clientAddress]);

  if (!clientName.trim()) return null;
  if (photos && !photos.configured) return null; // Drive not connected: stay out of the way

  const mine = roundsForQuote(photos);
  const others = photos ? photos.rounds.filter((r) => r.quoteId && r.quoteId !== photos.quoteId).length : 0;
  const folderLabel = photos?.folder
    ? [photos.folder.clientFolder.name, photos.folder.propertyFolder?.name, photos.folder.chosenDateFolder?.date].filter(Boolean).join(" / ")
    : null;

  return (
    <section className="mb-5 rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-2 text-left">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-ink">Job photos</span>
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {loading ? "loading from Drive…" : folderLabel ? folderLabel : photos?.error ? "not loaded" : ""}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {photos && photos.needsYou.length > 0 && (
            <span className="rounded-full bg-flag/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-flag">
              {photos.needsYou.length} needs you
            </span>
          )}
          <button
            onClick={() => void loadPhotos()}
            disabled={loading}
            className="rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted transition hover:text-ink disabled:opacity-40"
            aria-label="Reload photos"
          >
            {loading ? "…" : "Reload"}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 px-4 py-3">
          {photos?.error && <p className="text-xs text-flag">{photos.error}</p>}
          {photos && photos.needsYou.map((c, i) => <NeedsYou key={i} card={c} result={photos} />)}

          {photos && mine.length === 0 && !photos.error && photos.needsYou.length === 0 && (
            <p className="text-xs text-muted">No photos matched to this quote yet.</p>
          )}
          {mine.map((r) => (
            <RoundBlock key={r.key} round={r} />
          ))}
          {others > 0 && (
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {others} other round{others === 1 ? "" : "s"} on this property belong to other quotes
            </p>
          )}
          {photos && photos.skipped.length > 0 && (
            <p className="text-[11px] text-muted">
              Left in the folder, not quote photos: {photos.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function RoundBlock({ round, compact }: { round: MatchedRound; compact?: boolean }) {
  const start = toEastern(round.startedAt);
  const end = toEastern(round.endedAt);
  const when = start.date === end.date ? `${start.date} · ${start.time}${end.time !== start.time ? ` to ${end.time}` : ""}` : `${start.date} to ${end.date}`;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[confidenceColor(round.confidence)]}`} title={`Date confidence: ${round.confidence}`} />
        <span className="font-mono text-[11px] text-ink">{when}</span>
        {round.role && <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${ROLE_TONE[round.role]}`}>{round.role}</span>}
        {round.dateFolder && <span className="font-mono text-[10px] text-muted">folder {round.dateFolder.date}</span>}
        {round.reason === "manual" && <span className="font-mono text-[10px] text-muted">your pick</span>}
        <span className="font-mono text-[10px] text-muted">{round.photos.length} photo{round.photos.length === 1 ? "" : "s"}</span>
      </div>
      <Thumbs round={round} size={compact ? 64 : 96} />
    </div>
  );
}

function Thumbs({ round, size }: { round: MatchedRound; size: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {round.photos
        .filter((p) => !p.skipped)
        .map((p) => (
          <a
            key={p.file.id}
            href={p.file.webViewLink ?? `https://drive.google.com/file/d/${p.file.id}/view`}
            target="_blank"
            rel="noreferrer"
            title={`${p.file.name}\n${p.source ?? "no date"} · ${p.confidence}${p.flags.length ? "\n" + p.flags.map((f) => f.detail).join("\n") : ""}`}
            className="relative block overflow-hidden rounded-md border border-border bg-card-2"
            style={{ width: size, height: size }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(p.smallFile?.id ?? p.file.id, size * 2)} alt={p.file.name} loading="lazy" className="h-full w-full object-cover" />
            <span className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-1 ring-black/60 ${DOT[confidenceColor(p.confidence)]}`} />
          </a>
        ))}
    </div>
  );
}

function NeedsYou({ card, result }: { card: NeedsYouCard; result: PhotoLoadResult }) {
  const assignRound = useEstimateStore((s) => s.assignRound);
  const sortPhotos = useEstimateStore((s) => s.sortPhotos);
  const setUpPhotoFolder = useEstimateStore((s) => s.setUpPhotoFolder);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const shell = (children: React.ReactNode) => (
    <div className="rounded-lg border border-flag/40 bg-flag/10 p-3">
      <div className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-flag">{card.title}</div>
      <p className="mt-1 whitespace-pre-wrap text-xs text-ink/90">{card.detail}</p>
      {children}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );

  if (card.kind === "pick_quote") {
    return shell(
      <div className="mt-2 space-y-2">
        <Thumbs round={card.round} size={64} />
        <div className="flex flex-wrap gap-1.5">
          {card.choices.map((c) => (
            <button
              key={c.quoteId}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await assignRound(card.round.key, c.quoteId);
                setBusy(false);
              }}
              className={`rounded-md border px-2.5 py-1 text-xs transition disabled:opacity-40 ${
                c.quoteId === result.quoteId ? "border-brand bg-brand/15 text-brand hover:bg-brand/25" : "border-border text-ink hover:border-brand/50"
              }`}
            >
              {c.quoteId === result.quoteId ? "This quote" : c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (card.kind === "sort_photos") {
    const moves = card.rounds.map((x) => ({ date: x.suggestedDate, fileIds: x.round.photos.filter((p) => !p.skipped).map((p) => p.file.id) }));
    return shell(
      <div className="mt-2 space-y-3">
        {card.rounds.map((x) => {
          const q = result.quotes.find((qq) => qq.id === x.suggestedQuoteId);
          return (
            <div key={x.round.key}>
              <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <span className="text-ink">{easternDate(x.round.startedAt)}</span>
                <span className="text-muted">→ folder {x.suggestedDate}</span>
                <span className="text-muted">{q ? `for ${q.label}` : "quote not picked yet"}</span>
              </div>
              <Thumbs round={x.round} size={56} />
            </div>
          );
        })}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(await sortPhotos(card.propertyFolderId, moves));
            setBusy(false);
          }}
          className="rounded-md bg-brand px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
        >
          {busy ? "Moving…" : "Sort photos into date folders"}
        </button>
      </div>
    );
  }

  if (card.kind === "no_property_folder") {
    return shell(
      <div className="mt-2">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(await setUpPhotoFolder());
            setBusy(false);
          }}
          className="rounded-md border border-brand/60 bg-brand/10 px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-brand transition hover:bg-brand/20 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Set up folder"}
        </button>
      </div>
    );
  }

  return shell(null);
}
