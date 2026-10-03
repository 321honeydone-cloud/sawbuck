// Price memory for the learning rate books.
//
// Before this, both rate books were "last price wins": one discounted friend
// job overwrote a good number until someone fixed it by hand, and a quote the
// client turned down taught exactly as much as one that got paid. Now every
// learned price keeps a short history of samples, one per quote line, and the
// price the estimator sees is the weighted middle of that history:
//
//   - Your own edits count double an AI line you just accepted.
//   - A quote marked Invoiced (won) counts triple. A deleted quote counts half.
//   - Newer jobs count more than older ones, so real price moves still land.
//   - Re-editing the same line on the same quote replaces its sample instead of
//     stacking, so typing 15, then 150, then 165 is one job, not three.
//   - A price you set on the Rate Book screen counts like several jobs at once.
//
// Weighted MEDIAN, not average, so one oddball job can't drag the number.
//
// Pure and isomorphic (no prisma, no fs) so the routes and any client code can
// share the same math.

export type SampleOutcome = "won" | "deleted";

export interface PriceSample {
  /** the price this job used */
  v: number;
  /** base weight from where it came from (see WEIGHT) */
  w: number;
  /** "<estimateId>:<lineId>" for quote lines, "screen", "book" or "legacy" otherwise */
  ref: string;
  /** set when the quote it came from was invoiced or deleted */
  o?: SampleOutcome;
  at: string; // ISO
}

export const WEIGHT = {
  ai: 1,
  manual: 2,
  /** a price that was already there before samples existed */
  legacy: 1,
  /** a price set on the Rate Book screen */
  screen: 4,
} as const;

const OUTCOME_FACTOR: Record<SampleOutcome, number> = { won: 3, deleted: 0.5 };

/** Each step older than the newest sample keeps this share of its weight. */
const RECENCY = 0.85;
/** Samples kept per price. Older ones fall off, which also lets prices drift. */
export const MAX_SAMPLES = 12;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sample ref for one line on one quote. */
export function lineRef(estimateId: string, lineId: string): string {
  return `${estimateId}:${lineId}`;
}

/** Make a sample list out of a single pre-existing price (for old rows). */
export function seedSamples(price: number | null | undefined, w: number = WEIGHT.legacy, ref = "legacy", at?: string): PriceSample[] {
  return typeof price === "number" && price > 0 ? [{ v: round2(price), w, ref, at: at ?? new Date().toISOString() }] : [];
}

/**
 * Add one sample, newest last. A sample with the same ref replaces the old one
 * (keeping any outcome already stamped on it), and the list is capped.
 */
export function addSample(samples: PriceSample[] | undefined, s: Omit<PriceSample, "at"> & { at?: string }): PriceSample[] {
  const list = (samples ?? []).filter((x) => x.ref !== s.ref);
  const prev = (samples ?? []).find((x) => x.ref === s.ref);
  const next: PriceSample = { v: round2(s.v), w: s.w, ref: s.ref, at: s.at ?? new Date().toISOString() };
  const o = s.o ?? prev?.o;
  if (o) next.o = o;
  list.push(next);
  return list.slice(-MAX_SAMPLES);
}

/**
 * Stamp (or clear) an outcome on every sample that came from one quote.
 * Returns null when nothing changed so callers can skip a write.
 */
export function markOutcome(samples: PriceSample[] | undefined, estimateId: string, outcome: SampleOutcome | null): PriceSample[] | null {
  if (!samples || samples.length === 0) return null;
  const prefix = `${estimateId}:`;
  let changed = false;
  const next = samples.map((s) => {
    if (!s.ref.startsWith(prefix) || (s.o ?? null) === outcome) return s;
    changed = true;
    const copy: PriceSample = { ...s };
    if (outcome) copy.o = outcome;
    else delete copy.o;
    return copy;
  });
  return changed ? next : null;
}

/** Weight a sample actually carries right now, given its age rank (0 = newest). */
function effectiveWeight(s: PriceSample, ageRank: number): number {
  const outcome = s.o ? OUTCOME_FACTOR[s.o] : 1;
  return s.w * outcome * Math.pow(RECENCY, ageRank);
}

/** The learned price: weighted median of the samples. null when there are none. */
export function learnedPrice(samples: PriceSample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null;
  const n = samples.length;
  const weighted = samples
    .map((s, i) => ({ v: s.v, w: effectiveWeight(s, n - 1 - i) }))
    .filter((x) => x.v > 0 && x.w > 0)
    .sort((a, b) => a.v - b.v);
  if (weighted.length === 0) return null;
  const total = weighted.reduce((t, x) => t + x.w, 0);
  const half = total / 2;
  let cum = 0;
  for (let i = 0; i < weighted.length; i++) {
    cum += weighted[i].w;
    // Landing exactly on the halfway mark means two prices split the vote
    // evenly; meet in the middle instead of always picking the lower one.
    if (Math.abs(cum - half) < 1e-9 && i + 1 < weighted.length) return round2((weighted[i].v + weighted[i + 1].v) / 2);
    if (cum > half) return weighted[i].v;
  }
  return weighted[weighted.length - 1].v;
}

/** Quick facts for the Admin learning card. */
export function sampleStats(samples: PriceSample[] | undefined): { jobs: number; won: number; low: number; high: number } {
  const quoteSamples = (samples ?? []).filter((s) => s.ref.includes(":"));
  const vals = quoteSamples.map((s) => s.v);
  return {
    jobs: quoteSamples.length,
    won: quoteSamples.filter((s) => s.o === "won").length,
    low: vals.length ? Math.min(...vals) : 0,
    high: vals.length ? Math.max(...vals) : 0,
  };
}
