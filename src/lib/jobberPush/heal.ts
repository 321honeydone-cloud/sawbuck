// The repair functions the playbook names. Every fix gets the same context
// and reports what it did, whether it wrote to Jobber, and whether it needs
// Manny before anything else can happen. Only the two Zapier actions are ever
// called: read and safe_update. There is no per line delete or add action, so
// the delete and add fixes converge the quote by re reading, working out the
// exact leftover or missing lines (logged so the send log shows them), then
// running safe_update with SawBUCK's full set. safe_update adds first and
// deletes the old ids one at a time, so the quote is never empty on the way.

import type { Estimate } from "../types";
import { diffLines } from "./compare";
import { titleFromScope } from "./expected";
import type { SendLog } from "./sendLog";
import type { ExpectedPush, FixName, HealAttempt, JobberQuoteRead, PlaybookEntry, SafeUpdateInput, SafeUpdateResult } from "./types";
import type { JobberTransport } from "./zapier";

/** Price book hooks the fixes need. The route backs this with the AppSetting table. */
export interface PushSettings {
  getTaxRateId(): Promise<string | null>;
  setTaxRateId(id: string, label?: string): Promise<void>;
}

export interface HealContext {
  transport: JobberTransport;
  settings: PushSettings;
  estimate: Estimate;
  /** Mutable on purpose: build_title_from_scope fills it in. */
  expected: ExpectedPush;
  quoteId: string;
  quoteRef: string;
  lastRead: JobberQuoteRead | null;
  lastResult: SafeUpdateResult | null;
  log: SendLog;
  entry: PlaybookEntry;
  signal: string;
  attempts: HealAttempt[];
  /** Wraps transport.safeUpdate so the orchestrator can count writes. */
  write: (input: SafeUpdateInput) => Promise<SafeUpdateResult>;
}

export interface FixOutcome {
  ok: boolean;
  note: string;
  result?: SafeUpdateResult;
  /** Set when the fix cannot go on without Manny. Plain English. */
  needsManny?: string;
  wrote: boolean;
}

export function fullInput(ctx: Pick<HealContext, "expected" | "quoteId">, extra: Partial<SafeUpdateInput> = {}): SafeUpdateInput {
  return {
    quote_id: ctx.quoteId,
    line_items: ctx.expected.lines,
    title: ctx.expected.title,
    message: ctx.expected.message,
    expected_subtotal: ctx.expected.subtotal,
    ...extra,
  };
}

async function reread(ctx: HealContext): Promise<JobberQuoteRead> {
  const read = await ctx.transport.read(ctx.quoteRef);
  ctx.lastRead = read;
  return read;
}

/** Pick a tax rate id: price book first, then a lookup if one is enabled. */
async function resolveTaxRateId(ctx: HealContext): Promise<{ id: string | null; note: string }> {
  const saved = await ctx.settings.getTaxRateId();
  if (saved) return { id: saved, note: `Using jobberTaxRateId ${saved} from the price book.` };
  const rates = ctx.transport.listTaxRates ? await ctx.transport.listTaxRates() : null;
  if (!rates || !rates.length) {
    return { id: null, note: "No jobberTaxRateId in the price book and no tax rate lookup action is enabled." };
  }
  const pick = rates.length === 1 ? rates[0] : rates.find((r) => /brevard|florida|fl\b|sales/i.test(r.name)) ?? rates[0];
  await ctx.settings.setTaxRateId(pick.id, pick.name);
  return { id: pick.id, note: `Looked up Jobber tax rates, saved "${pick.name}" (${pick.id}) as jobberTaxRateId.` };
}

export const FIXES: Record<FixName, (ctx: HealContext) => Promise<FixOutcome>> = {
  async route_safe_update(ctx) {
    const result = await ctx.write(fullInput(ctx));
    return { ok: result.status === "OK", note: "Routed the update through safe_update (add new lines, verify, delete old, tax, then text).", result, wrote: true };
  },

  async delete_remaining_old_lines(ctx) {
    const read = await reread(ctx);
    const { extra } = diffLines(ctx.expected.lines, read.lineItems);
    const ids = extra.map((l) => l.id ?? `${l.name} $${l.unitPrice}`);
    if (!extra.length) {
      return { ok: true, note: "Re read: no old lines remain on the quote.", wrote: false };
    }
    const result = await ctx.write(fullInput(ctx));
    return {
      ok: result.status === "OK",
      note: `Re read found ${extra.length} old line${extra.length === 1 ? "" : "s"} still on the quote (${ids.join(", ")}). Ran safe_update so each old id gets deleted one at a time after the SawBUCK set is on.`,
      result,
      wrote: true,
    };
  },

  async add_missing_lines(ctx) {
    const read = await reread(ctx);
    const { missing, extra } = diffLines(ctx.expected.lines, read.lineItems);
    if (!missing.length && !extra.length) {
      return { ok: true, note: "Re read: every SawBUCK line is already on the quote.", wrote: false };
    }
    const names = missing.map((l) => `${l.name} $${l.unit_price.toFixed(2)}`);
    const result = await ctx.write(fullInput(ctx));
    return {
      ok: result.status === "OK",
      note: `Re read found ${missing.length} missing line${missing.length === 1 ? "" : "s"} (${names.join(", ") || "none"}). Ran safe_update so only the SawBUCK set is left.`,
      result,
      wrote: true,
    };
  },

  async rerun_safe_update_once(ctx) {
    // The orchestrator records the current attempt before calling us, so one
    // entry is this run. A second one means the re run already happened.
    const already = ctx.attempts.filter((a) => a.fix === "rerun_safe_update_once" && a.ran).length > 1;
    if (already) {
      return { ok: false, note: "safe_update was already re run once for a subtotal mismatch.", needsManny: "The subtotal still does not match SawBUCK after one re run. Check the lines in the diff.", wrote: false };
    }
    const read = await reread(ctx);
    const { missing, extra } = diffLines(ctx.expected.lines, read.lineItems);
    const result = await ctx.write(fullInput(ctx));
    return {
      ok: result.status === "OK",
      note: `Re read: ${missing.length} SawBUCK line(s) missing, ${extra.length} unexpected line(s), quote subtotal $${read.subtotal.toFixed(2)} vs SawBUCK $${ctx.expected.subtotal.toFixed(2)}. Re ran safe_update once with expected_subtotal.`,
      result,
      wrote: true,
    };
  },

  async apply_tax_rate(ctx) {
    const { id, note } = await resolveTaxRateId(ctx);
    if (!id) {
      return {
        ok: false,
        note,
        needsManny: "Jobber needs a tax rate id to tax the materials line. Give me the Jobber tax rate (or its id) in the chat box and I will save it to the price book and re run.",
        wrote: false,
      };
    }
    const result = await ctx.write(fullInput(ctx, { tax_rate_id: id }));
    return { ok: result.status === "OK", note: `${note} Re ran safe_update with tax_rate_id.`, result, wrote: true };
  },

  async build_title_from_scope(ctx) {
    const title = titleFromScope(ctx.estimate);
    ctx.expected.title = title;
    if (!ctx.lastResult) {
      // Nothing pushed yet: the orchestrator's first safe_update carries the new title.
      return { ok: true, note: `Built the title "${title}" from the scope.`, wrote: false };
    }
    const result = await ctx.write(fullInput(ctx));
    return { ok: result.status === "OK", note: `Built the title "${title}" from the scope and pushed it with the lines.`, result, wrote: true };
  },

  async flag_undefined_field(ctx) {
    const err = ctx.lastResult?.error ?? ctx.signal;
    const m = err.match(/undefinedField[^'"\w]*['"]?(\w+)/i) ?? err.match(/Field ['"](\w+)['"] doesn't exist/i);
    const field = m ? m[1] : "(field name not found in the error text)";
    await ctx.log.add("heal_fix", "FLAGGED", { note: `GraphQL undefinedField: ${field}. Zapier code action needs regeneration.`, error: err });
    return {
      ok: false,
      note: `Logged the undefined field "${field}".`,
      needsManny: `Jobber's API no longer has the field "${field}" the Zapier code action asks for. The code action needs to be regenerated before any push can work.`,
      wrote: false,
    };
  },

  async stop_not_draft(ctx) {
    const status = ctx.lastRead?.quoteStatus ?? "not draft";
    return {
      ok: false,
      note: `Quote is ${status}. Nothing written.`,
      needsManny: `Quote ${ctx.lastRead?.quoteNumber ?? ctx.quoteRef} is ${status}, not a draft. SawBUCK only updates draft quotes. Open it in Jobber if it needs to change.`,
      wrote: false,
    };
  },

  async replay_approved_update(ctx) {
    const args = ctx.entry.fix_args ?? {};
    const extra: Partial<SafeUpdateInput> = {};
    if (args.with_tax) {
      const id = await ctx.settings.getTaxRateId();
      if (id) extra.tax_rate_id = id;
    }
    if (args.with_text === false) {
      extra.title = undefined;
      extra.message = undefined;
    }
    const result = await ctx.write(fullInput(ctx, extra));
    return { ok: result.status === "OK", note: `Replayed the fix Manny approved before for "${ctx.entry.match}" (safe_update with SawBUCK's lines${args.with_tax ? " and tax" : ""}).`, result, wrote: true };
  },
};

/** Fixes that never write to Jobber. Safe to run even when the entry is not auto, so the diagnosis lands in the log. */
export const NO_WRITE_FIXES: ReadonlySet<FixName> = new Set<FixName>(["flag_undefined_field", "stop_not_draft"]);

export function runFix(name: FixName, ctx: HealContext): Promise<FixOutcome> {
  const fn = FIXES[name];
  if (!fn) return Promise.resolve({ ok: false, note: `Unknown fix "${name}".`, needsManny: `The playbook names a fix SawBUCK does not have: ${name}.`, wrote: false });
  return fn(ctx);
}
