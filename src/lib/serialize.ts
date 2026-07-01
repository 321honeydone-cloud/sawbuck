// Bridge between the Prisma row (scalar columns + a `data` JSON blob) and the
// in-memory `Estimate` domain object used by the UI and operations engine.

import type { Estimate, EstimateStatus, Exclusion, FinishLevel, Group, Totals } from "./types";
import { recalcEstimate } from "./totals";

export interface EstimateRow {
  id: string;
  projectId: string;
  name: string;
  status: string;
  location: string | null;
  markupDefault: number;
  finishLevel: string;
  aiUpdateCount: number;
  data: string; // JSON: { groups, totals }
}

export function estimateFromRow(row: EstimateRow): Estimate {
  let parsed: { groups?: Group[]; totals?: Totals; clientName?: string | null; clientAddress?: string | null; exclusions?: Exclusion[] } = {};
  try {
    parsed = JSON.parse(row.data || "{}");
  } catch {
    parsed = {};
  }
  const estimate: Estimate = {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status as EstimateStatus,
    location: row.location,
    markupDefault: row.markupDefault,
    finishLevel: row.finishLevel as FinishLevel,
    aiUpdateCount: row.aiUpdateCount,
    groups: parsed.groups ?? [],
    totals: parsed.totals ?? { totalCost: 0, totalMarkup: 0, estimateTotal: 0, profitMargin: 0 },
    clientName: parsed.clientName ?? null,
    clientAddress: parsed.clientAddress ?? null,
    exclusions: parsed.exclusions ?? [],
  };
  // Trust the stored numbers but reconcile derived fields defensively.
  return recalcEstimate(estimate);
}

/** Flatten an Estimate back to the columns + JSON blob Prisma persists. */
export function rowFromEstimate(estimate: Estimate): EstimateRow {
  return {
    id: estimate.id,
    projectId: estimate.projectId,
    name: estimate.name,
    status: estimate.status,
    location: estimate.location,
    markupDefault: estimate.markupDefault,
    finishLevel: estimate.finishLevel,
    aiUpdateCount: estimate.aiUpdateCount,
    data: JSON.stringify({ groups: estimate.groups, totals: estimate.totals, clientName: estimate.clientName ?? null, clientAddress: estimate.clientAddress ?? null, exclusions: estimate.exclusions ?? [] }),
  };
}
