// photo_loader: group photos into rounds and match rounds to quotes.
//
// Rules (from the build spec, 2026-09-30):
//   - Sort by date. A gap of more than 12 hours starts a new round.
//   - A round taken after a quote is approved, up to 7 days after the job is
//     marked complete, belongs to that same job (Progress, or After for the last
//     round in that window). It never starts a new quote.
//   - Otherwise a round goes to the first quote on the property created on or
//     after the round, within 14 days. Tagged Before.
//   - A round taken after a quote was created but before it was approved is
//     also Before on that quote.
//   - A date folder is the link and wins over photo dates.
//   - Anything that does not match cleanly goes to Needs you: only LOW
//     confidence dates, two quotes within the same week, no window, future
//     dates, and so on. Never guess and attach.

import type { Confidence, DatedPhoto, MatchReason, MatchedRound, QuoteWindow, Round, RoundRole } from "./types";
import { easternDate } from "./dates";

export const ROUND_GAP_MS = 12 * 60 * 60 * 1000;
export const QUOTE_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;
export const AFTER_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const SAME_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const worst = (a: Confidence, b: Confidence): Confidence => {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
};

/** Small stable hash (FNV-1a) so a round keeps the same key across loads. */
export function roundKey(fileIds: string[]): string {
  const s = [...fileIds].sort().join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "r_" + h.toString(16).padStart(8, "0") + "_" + fileIds.length;
}

/**
 * Drop exact re-uploads (same name and size). The earliest upload stays, the
 * later copies are flagged as duplicates and skipped. Nothing is touched in Drive.
 */
export function dedupePhotos(photos: DatedPhoto[]): DatedPhoto[] {
  const seen = new Map<string, DatedPhoto>();
  const out: DatedPhoto[] = [];
  const sorted = [...photos].sort((a, b) => Date.parse(a.file.createdTime) - Date.parse(b.file.createdTime));
  for (const p of sorted) {
    if (p.skipped) {
      out.push(p);
      continue;
    }
    const k = `${p.file.name.toLowerCase()}::${p.file.size ?? "?"}`;
    const first = seen.get(k);
    if (first && p.file.size != null) {
      out.push({
        ...p,
        skipped: true,
        skipReason: `duplicate upload of ${first.file.name}`,
        flags: [...p.flags, { kind: "duplicate", detail: `Same name and size as ${first.file.id}` }],
      });
      continue;
    }
    seen.set(k, p);
    out.push(p);
  }
  return out;
}

/** Group dated photos into rounds. Photos with no date are left out (the caller flags them). */
export function groupRounds(
  photos: DatedPhoto[],
  dateFolder?: { id: string; name: string; date: string } | null
): Round[] {
  const dated = photos
    .filter((p) => !p.skipped && p.takenAt)
    .sort((a, b) => Date.parse(a.takenAt!) - Date.parse(b.takenAt!));
  const rounds: Round[] = [];
  let cur: DatedPhoto[] = [];
  let lastMs = 0;
  const flush = () => {
    if (!cur.length) return;
    const startedAt = cur[0].takenAt!;
    const endedAt = cur[cur.length - 1].takenAt!;
    rounds.push({
      key: roundKey(cur.map((p) => p.file.id)),
      startedAt,
      endedAt,
      photos: cur,
      confidence: cur.reduce<Confidence>((c, p) => worst(c, p.confidence), "high"),
      dateFolder: dateFolder ?? null,
    });
    cur = [];
  };
  for (const p of dated) {
    const ms = Date.parse(p.takenAt!);
    if (cur.length && ms - lastMs > ROUND_GAP_MS) flush();
    cur.push(p);
    lastMs = ms;
  }
  flush();
  return rounds;
}

export interface MatchOptions {
  now?: number;
  /** Manual picks Manny already made: round key -> quote + role. */
  assignments?: Record<string, { quoteId: string; role?: RoundRole | null }>;
}

interface Candidate {
  quote: QuoteWindow;
  reason: MatchReason;
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** Which quotes can a round land in, and why. Returned in priority order. */
function candidatesFor(round: Round, quotes: QuoteWindow[], now: number): { job: Candidate[]; before: Candidate[]; between: Candidate[] } {
  const s = Date.parse(round.startedAt);
  const job: Candidate[] = [];
  const before: Candidate[] = [];
  const between: Candidate[] = [];
  for (const q of quotes) {
    const created = ms(q.createdAt);
    const approved = ms(q.approvedAt);
    const completed = ms(q.jobCompletedAt);
    if (!Number.isFinite(created)) continue;
    // Job photos: after approval, up to 7 days after the job was marked complete
    // (or up to now while the job is still open).
    if (Number.isFinite(approved) && s >= approved) {
      const windowEnd = Number.isFinite(completed) ? completed + AFTER_GRACE_MS : now + 60 * 60 * 1000;
      if (s <= windowEnd) job.push({ quote: q, reason: "after_approval" });
    }
    // Before photos: quote created on or after the round, within 14 days.
    if (created >= s && created - s <= QUOTE_LOOKAHEAD_MS) before.push({ quote: q, reason: "before_created_after_round" });
    // Before photos taken after the quote went in but before it was approved.
    if (created < s) {
      const stillBefore = Number.isFinite(approved) ? s < approved : s - created <= QUOTE_LOOKAHEAD_MS;
      if (stillBefore) between.push({ quote: q, reason: "before_between_created_and_approval" });
    }
  }
  before.sort((a, b) => ms(a.quote.createdAt) - ms(b.quote.createdAt));
  between.sort((a, b) => ms(b.quote.createdAt) - ms(a.quote.createdAt)); // most recent quote first
  return { job, before, between };
}

/** Two quotes on the same property within the same week: never guess. */
function withinSameWeek(a: QuoteWindow, b: QuoteWindow): boolean {
  return Math.abs(ms(a.createdAt) - ms(b.createdAt)) <= SAME_WEEK_MS;
}

/**
 * Match every round to a quote, or send it to Needs you. Roles: Before for
 * rounds up to approval, Progress/After for rounds inside the job window.
 */
export function matchRounds(rounds: Round[], quotes: QuoteWindow[], opts: MatchOptions = {}): MatchedRound[] {
  const now = opts.now ?? Date.now();
  const assignments = opts.assignments ?? {};
  const out: MatchedRound[] = [];

  for (const r of rounds) {
    const manual = assignments[r.key];
    if (manual && quotes.some((q) => q.id === manual.quoteId)) {
      const q = quotes.find((x) => x.id === manual.quoteId)!;
      out.push({ ...r, quoteId: q.id, role: manual.role ?? roleByTiming(r, q), reason: "manual", needsYou: null });
      continue;
    }

    // Date folder is the link. It wins over any photo dates.
    if (r.dateFolder) {
      const pinned = quotes.filter((q) => q.dateFolder === r.dateFolder!.date);
      if (pinned.length === 1) {
        out.push({ ...r, quoteId: pinned[0].id, role: roleByTiming(r, pinned[0]), reason: "date_folder", needsYou: null });
        continue;
      }
      if (pinned.length > 1) {
        out.push({ ...r, quoteId: null, role: null, reason: null, needsYou: `More than one quote is pinned to the ${r.dateFolder.date} folder.` });
        continue;
      }
      // No quote pinned to this folder: fall through to the timing rules.
    }

    if (r.confidence === "low") {
      out.push({ ...r, quoteId: null, role: null, reason: null, needsYou: "Only upload times for these photos (no EXIF or filename date). Pick the quote." });
      continue;
    }

    const c = candidatesFor(r, quotes, now);

    // 1. Job window wins: photos after approval belong to that job, never a new quote.
    if (c.job.length === 1) {
      const q = c.job[0].quote;
      const jobOpen = !q.jobCompletedAt;
      if (jobOpen && c.before.length > 0) {
        out.push({ ...r, quoteId: null, role: null, reason: null, needsYou: `Could be progress on "${q.label}" (still open) or the before photos for "${c.before[0].quote.label}". Pick one.` });
        continue;
      }
      out.push({ ...r, quoteId: q.id, role: "Progress", reason: "after_approval", needsYou: null });
      continue;
    }
    if (c.job.length > 1) {
      out.push({ ...r, quoteId: null, role: null, reason: null, needsYou: "More than one approved job on this property covers these dates. Pick one." });
      continue;
    }

    // 2. First quote created on or after the round, within 14 days.
    if (c.before.length >= 1) {
      if (c.before.length > 1 && withinSameWeek(c.before[0].quote, c.before[1].quote)) {
        out.push({ ...r, quoteId: null, role: null, reason: null, needsYou: `Two quotes on this property within the same week ("${c.before[0].quote.label}" and "${c.before[1].quote.label}"). Pick one.` });
        continue;
      }
      out.push({ ...r, quoteId: c.before[0].quote.id, role: "Before", reason: "before_created_after_round", needsYou: null });
      continue;
    }

    // 3. Taken after the quote went in, before it was approved.
    if (c.between.length === 1) {
      out.push({ ...r, quoteId: c.between[0].quote.id, role: "Before", reason: "before_between_created_and_approval", needsYou: null });
      continue;
    }
    if (c.between.length > 1) {
      out.push({ ...r, quoteId: null, role: null, reason: null, needsYou: "More than one open quote on this property could own these photos. Pick one." });
      continue;
    }

    out.push({ ...r, quoteId: null, role: null, reason: null, needsYou: "These photos fit no quote window on this property." });
  }

  // After = the last round inside each job window; the earlier ones stay Progress.
  const byQuote = new Map<string, MatchedRound[]>();
  for (const r of out) {
    if (r.quoteId && (r.role === "Progress" || r.role === "After")) {
      const list = byQuote.get(r.quoteId) ?? [];
      list.push(r);
      byQuote.set(r.quoteId, list);
    }
  }
  for (const list of byQuote.values()) {
    list.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    for (let i = 0; i < list.length; i++) list[i].role = i === list.length - 1 ? "After" : "Progress";
  }
  return out;
}

/** Before up to approval, Progress after it. (After is assigned across rounds by matchRounds.) */
function roleByTiming(r: Round, q: QuoteWindow): RoundRole {
  const approved = ms(q.approvedAt);
  if (Number.isFinite(approved) && Date.parse(r.startedAt) >= approved) return "Progress";
  return "Before";
}

/** Pick the date folder for a quote: same date, else the closest on or before the created date within 14 days. */
export function pickDateFolder<T extends { date: string }>(folders: T[], quoteCreatedAt: string): T | null {
  const created = Date.parse(quoteCreatedAt);
  if (!Number.isFinite(created)) return null;
  const createdDay = easternDate(created);
  let best: T | null = null;
  let bestGap = Infinity;
  for (const f of folders) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) continue;
    if (f.date === createdDay) return f;
    const fMs = Date.parse(f.date + "T12:00:00Z");
    const gap = created - fMs;
    if (gap >= 0 && gap <= QUOTE_LOOKAHEAD_MS && gap < bestGap) {
      best = f;
      bestGap = gap;
    }
  }
  return best;
}
