// The self heal playbook: data/heal-playbook.json. Each entry pairs an error
// text or status with a named repair function. The heal loop reads it on every
// failure, the chat box teaches it new entries, and approvals promote learned
// entries to automatic. Server only (fs).
//
// Path: data/heal-playbook.json, or SAWBUCK_PLAYBOOK_PATH on a persistent
// volume. The seeded file ships with the repo, so a missing file is rebuilt
// from the in code seed below.

import { promises as fs } from "fs";
import path from "path";
import type { FixName, PlaybookEntry } from "./types";

export const PLAYBOOK_PATH = process.env.SAWBUCK_PLAYBOOK_PATH || path.join(process.cwd(), "data", "heal-playbook.json");

/** How many chat approvals a learned fix needs before it runs on its own. */
export const LEARNED_AUTO_AFTER = 2;

export interface Playbook {
  version: number;
  notes?: string;
  entries: PlaybookEntry[];
}

export const SEED_ENTRIES: PlaybookEntry[] = [
  { id: "seed-quote-blank", match: "Quote can't be blank", diagnosis: "The old Zapier Update Quote action deleted every line before adding the new ones and Jobber refused the empty quote. The quote is split: new text, old prices. Retrying that action can never work.", fix: "route_safe_update", auto: true, hits: 0, last_seen: null, source: "seeded" },
  { id: "seed-failed-delete", match: "FAILED_DELETE", diagnosis: "New lines landed but Jobber choked deleting the old ones, so the quote carries both sets. Re read, find the old line ids still on the quote, and run safe_update again so they get deleted one at a time and the new set is left as the only copy.", fix: "delete_remaining_old_lines", auto: true, hits: 0, last_seen: null, source: "seeded" },
  { id: "seed-failed-add", match: "FAILED_ADD", diagnosis: "Jobber rejected or dropped some of the new lines before the old ones were touched. Re read, work out which SawBUCK lines are missing, and add them through safe_update so the quote ends with exactly the SawBUCK set.", fix: "add_missing_lines", auto: true, hits: 0, last_seen: null, source: "seeded" },
  { id: "seed-mismatch-subtotal", match: "MISMATCH on subtotal", diagnosis: "safe_update finished but the subtotal it read back is not SawBUCK's number. Re read, diff the lines against SawBUCK, and run safe_update once more with the expected subtotal.", fix: "rerun_safe_update_once", auto: true, hits: 0, last_seen: null, source: "seeded" },
  { id: "seed-tax-missing", match: "taxAmount 0 but taxable lines exist", diagnosis: "The materials line is marked taxable but the quote carries no tax rate, so Jobber shows $0 tax. Look up the Jobber tax rate, save its id to the price book as jobberTaxRateId, and re run safe_update with tax_rate_id. Confirm with Manny the first time, then it runs on its own.", fix: "apply_tax_rate", auto: false, auto_after_approvals: 1, approvals: 0, hits: 0, last_seen: null, source: "seeded" },
  { id: "seed-empty-title", match: "Empty job.title", diagnosis: "The quote has no title. Build one from the scope, for example \"Hooks, towel racks and wall art install\", and push it with the lines.", fix: "build_title_from_scope", auto: true, hits: 0, last_seen: null, source: "seeded" },
  { id: "seed-undefined-field", match: "GraphQL undefinedField", diagnosis: "Jobber's GraphQL schema no longer has a field the code action asks for. Log the field name and flag the Zapier code action for regeneration. Nothing to retry until the action is rebuilt.", fix: "flag_undefined_field", auto: false, hits: 0, last_seen: null, source: "seeded" },
  { id: "seed-not-draft", match: "BLOCKED_NOT_DRAFT", diagnosis: "The quote is no longer a draft (sent, approved, converted, or archived). SawBUCK only touches drafts. Stop and tell Manny. Nothing was written.", fix: "stop_not_draft", auto: false, hits: 0, last_seen: null, source: "seeded" },
];

/** Where the playbook lives. File backed by default, in memory for tests. */
export interface PlaybookStore {
  load(): Promise<Playbook>;
  save(pb: Playbook): Promise<void>;
}

export class FilePlaybookStore implements PlaybookStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private file = PLAYBOOK_PATH) {}

  async load(): Promise<Playbook> {
    try {
      const text = await fs.readFile(this.file, "utf8");
      const pb = JSON.parse(text) as Playbook;
      if (!Array.isArray(pb.entries)) throw new Error("no entries");
      // Any seeded entry missing from a hand edited file comes back.
      for (const s of SEED_ENTRIES) if (!pb.entries.some((e) => e.id === s.id)) pb.entries.push({ ...s });
      return pb;
    } catch {
      const pb: Playbook = { version: 1, entries: SEED_ENTRIES.map((e) => ({ ...e })) };
      await this.save(pb);
      return pb;
    }
  }

  save(pb: Playbook): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(pb, null, 2) + "\n", "utf8");
        await fs.rename(tmp, this.file);
      })
      .catch((err) => {
        console.warn("[playbook] save failed:", (err as Error).message);
      });
    return this.queue;
  }
}

export class MemoryPlaybookStore implements PlaybookStore {
  pb: Playbook;
  constructor(entries: PlaybookEntry[] = SEED_ENTRIES.map((e) => ({ ...e }))) {
    this.pb = { version: 1, entries };
  }
  async load() {
    return this.pb;
  }
  async save(pb: Playbook) {
    this.pb = pb;
  }
}

// ---------------------------------------------------------------------------
// Signals. The loop turns a failed push into short strings and matches the
// playbook against them. Order matters: the first signal with a hit wins.
// ---------------------------------------------------------------------------

export interface SignalInput {
  status?: string | null;
  error?: string | null;
  quoteStatus?: string | null;
  expectedTitle?: string | null;
  taxMissing?: boolean;
  subtotalMatch?: boolean | null;
}

export function deriveSignals(s: SignalInput): string[] {
  const out: string[] = [];
  if (s.quoteStatus && s.quoteStatus !== "draft") out.push("BLOCKED_NOT_DRAFT");
  // A broken schema outranks whatever step it broke: retrying is pointless.
  if (s.error && /undefinedField/i.test(s.error)) out.push("GraphQL undefinedField");
  if (s.status) {
    if (s.status === "MISMATCH" || (s.status === "OK" && s.subtotalMatch === false)) out.push("MISMATCH on subtotal");
    if (s.status !== "OK") out.push(s.status);
  }
  if (s.error) out.push(s.error);
  if (s.expectedTitle !== undefined && s.expectedTitle !== null && !s.expectedTitle.trim()) out.push("Empty job.title");
  if (s.taxMissing) out.push("taxAmount 0 but taxable lines exist");
  return Array.from(new Set(out));
}

/** First entry whose match text is found in any signal. Returns the signal too. */
export function matchPlaybook(pb: Playbook, signals: string[]): { entry: PlaybookEntry; signal: string } | null {
  for (const signal of signals) {
    const s = signal.toLowerCase();
    for (const entry of pb.entries) {
      const m = entry.match.toLowerCase();
      if (!m) continue;
      if (s === m || s.includes(m) || (entry.source === "learned" && m.includes(s) && s.length > 8)) {
        return { entry, signal };
      }
    }
  }
  return null;
}

/** Bump hits and last_seen. */
export async function recordHit(store: PlaybookStore, entryId: string): Promise<void> {
  const pb = await store.load();
  const e = pb.entries.find((x) => x.id === entryId);
  if (!e) return;
  e.hits = (e.hits ?? 0) + 1;
  e.last_seen = new Date().toISOString();
  await store.save(pb);
}

/**
 * Manny approved a fix from the chat box. Known entry: count the approval
 * and promote when it reaches auto_after_approvals. Unknown signal: learn a
 * new entry (auto false) that flips to auto after LEARNED_AUTO_AFTER approvals.
 */
export async function recordApproval(
  store: PlaybookStore,
  opts: { entryId?: string | null; signal?: string | null; fix: FixName; diagnosis: string; fixArgs?: PlaybookEntry["fix_args"] }
): Promise<{ entry: PlaybookEntry; promoted: boolean; learned: boolean }> {
  const pb = await store.load();
  let entry = opts.entryId ? pb.entries.find((x) => x.id === opts.entryId) : undefined;
  let learned = false;
  if (!entry && opts.signal) {
    const sig = opts.signal.trim().slice(0, 160);
    entry = pb.entries.find((x) => x.source === "learned" && x.match.toLowerCase() === sig.toLowerCase());
    if (!entry) {
      entry = {
        id: `learned-${Date.now().toString(36)}`,
        match: sig,
        diagnosis: opts.diagnosis,
        fix: opts.fix,
        auto: false,
        hits: 1,
        last_seen: new Date().toISOString(),
        source: "learned",
        approvals: 0,
        auto_after_approvals: LEARNED_AUTO_AFTER,
        fix_args: opts.fixArgs ?? null,
      };
      pb.entries.push(entry);
      learned = true;
    }
  }
  if (!entry) throw new Error("Nothing to approve against: no entry id and no signal.");
  entry.approvals = (entry.approvals ?? 0) + 1;
  entry.last_seen = new Date().toISOString();
  if (opts.fixArgs) entry.fix_args = opts.fixArgs;
  const threshold = entry.auto_after_approvals ?? (entry.source === "learned" ? LEARNED_AUTO_AFTER : null);
  let promoted = false;
  if (!entry.auto && threshold !== null && entry.approvals >= threshold) {
    entry.auto = true;
    promoted = true;
  }
  await store.save(pb);
  return { entry, promoted, learned };
}
