// photo_loader: the quotes on a property, as windows a photo round can land in.
//
// Source 1 (always): SawBUCK's own estimates for the same client and address.
// Source 2 (when JOBBER_* env is set): Jobber quotes and jobs for the client's
// matching property, merged in. A Jobber quote created within two days of a
// SawBUCK estimate for the same property is treated as the same quote, and
// Jobber's dates win because approval and job completion only exist there.

import { prisma } from "../db";
import { addressesMatch, streetLine } from "./address";
import { jobberConfigured, jobberQuotesForProperty, type JobberPropertyContext } from "./jobberApi";
import type { QuoteWindow } from "./types";

const APPROVED_STATUSES = new Set(["won", "complete", "invoiced"]);
const DONE_STATUSES = new Set(["complete", "invoiced"]);
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

export interface EstimateRowLite {
  id: string;
  name: string;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  data: string;
}

interface ParsedData {
  clientName?: string | null;
  clientAddress?: string | null;
  statusTimes?: Record<string, string>;
}

export function parseData(data: string): ParsedData {
  try {
    return JSON.parse(data || "{}") as ParsedData;
  } catch {
    return {};
  }
}

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());

/** One SawBUCK estimate as a quote window. */
export function windowFromEstimate(row: EstimateRowLite): QuoteWindow {
  const p = parseData(row.data);
  const st = p.statusTimes ?? {};
  const approvedAt = st.won ?? st.complete ?? st.invoiced ?? (APPROVED_STATUSES.has(row.status) ? iso(row.updatedAt) : null);
  const jobCompletedAt = st.complete ?? st.invoiced ?? (DONE_STATUSES.has(row.status) ? iso(row.updatedAt) : null);
  return {
    id: row.id,
    label: `${row.name} (${row.id})`,
    sawbuckEstimateId: row.id,
    jobberQuoteNumber: null,
    createdAt: iso(row.createdAt),
    approvedAt,
    jobCompletedAt,
  };
}

/** Same client (case-insensitive) and same property (normalized street line). */
export function sameProperty(a: ParsedData, b: ParsedData): boolean {
  const an = (a.clientName ?? "").trim().toLowerCase();
  const bn = (b.clientName ?? "").trim().toLowerCase();
  if (!an || an !== bn) return false;
  const aa = streetLine(a.clientAddress ?? "");
  const ba = streetLine(b.clientAddress ?? "");
  if (!aa && !ba) return true; // homeowner with no address on either quote
  if (!aa || !ba) return true; // one side blank: same client, assume same property
  return addressesMatch(aa, ba);
}

export interface PropertyContext {
  quotes: QuoteWindow[];
  /** From Jobber when configured: company flag and property count for the client. */
  jobber: JobberPropertyContext | null;
}

/** Every quote window on this estimate's property, this estimate first. */
export async function propertyContext(row: EstimateRowLite): Promise<PropertyContext> {
  const me = parseData(row.data);
  const rows = await prisma.estimate.findMany({
    select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, data: true },
  });
  const local = rows
    .filter((r) => r.id === row.id || sameProperty(me, parseData(r.data)))
    .map(windowFromEstimate);

  let jobber: JobberPropertyContext | null = null;
  if (jobberConfigured() && me.clientName) {
    try {
      jobber = await jobberQuotesForProperty(me.clientName, streetLine(me.clientAddress ?? ""));
    } catch {
      jobber = null; // Jobber down: SawBUCK's own windows still work
    }
  }

  const quotes = mergeWindows(local, jobber?.quotes ?? []);
  quotes.sort((a, b) => (a.id === row.id ? -1 : b.id === row.id ? 1 : Date.parse(a.createdAt) - Date.parse(b.createdAt)));
  return { quotes, jobber };
}

/** Fold Jobber windows into SawBUCK windows; near-same created dates collapse into one. */
export function mergeWindows(local: QuoteWindow[], remote: QuoteWindow[]): QuoteWindow[] {
  const out = local.map((w) => ({ ...w }));
  for (const r of remote) {
    const twin = out.find((w) => !w.jobberQuoteNumber && Math.abs(Date.parse(w.createdAt) - Date.parse(r.createdAt)) <= TWO_DAYS);
    if (twin) {
      twin.jobberQuoteNumber = r.jobberQuoteNumber ?? null;
      twin.label = `${twin.label} · Jobber #${r.jobberQuoteNumber}`;
      twin.approvedAt = r.approvedAt ?? twin.approvedAt ?? null;
      twin.jobCompletedAt = r.jobCompletedAt ?? twin.jobCompletedAt ?? null;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}
