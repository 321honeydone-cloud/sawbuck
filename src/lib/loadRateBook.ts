// Loads the rate book JSON and hands back a ready engine. The base prices live
// in src/data/rate_book.json (459 priced + 696 stubs). Manny's saved overrides
// (priced stubs and edited tasks) layer on top at runtime via setRateBookTasks,
// so the flat-rate quoter reflects his edits without a production rebuild.
import rateBookData from "@/data/rate_book.json";
import { RateBookEngine, type RateBook, type RateTask } from "./rateBook";

export const rateBook = rateBookData as unknown as RateBook;

// Engine built from the static base book only.
export const baseRateBookEngine = new RateBookEngine(rateBook);

// The engine the app actually prices against. Starts as the base engine and can
// be swapped (client side) once the saved overrides are fetched and merged in.
let activeEngine: RateBookEngine = baseRateBookEngine;

/** The live engine: base, or base+overrides once applyOverrides has been fed in. */
export function getRateBookEngine(): RateBookEngine {
  return activeEngine;
}

/** Rebuild the live engine from a merged task list (base book + Manny's edits). */
export function setRateBookTasks(tasks: RateTask[]): void {
  activeEngine = new RateBookEngine({ settings: rateBook.settings, tasks });
}

/** Back-compat export (the base engine). Prefer getRateBookEngine() for live prices. */
export const rateBookEngine = baseRateBookEngine;

/** Number of priced tasks the base book ships with. */
export const rateBookTaskCount = rateBook.tasks.filter((t) => t.final_price != null).length;
