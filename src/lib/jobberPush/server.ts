// Server side glue for the Jobber update path: the price book hooks (tax rate
// id lives in the AppSetting table), the per estimate quote ref, and the one
// place the routes get a transport and playbook store from.

import { prisma } from "../db";
import type { PushSettings } from "./heal";
import { FilePlaybookStore } from "./playbook";
import { defaultTransport } from "./zapier";

export const TAX_RATE_KEY = "jobberTaxRateId";
export const TAX_RATE_LABEL_KEY = "jobberTaxRateLabel";
const QUOTE_REF_PREFIX = "jobberQuoteRef:";

async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    return row?.value || null;
  } catch {
    return null;
  }
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Price book hooks. Env JOBBER_TAX_RATE_ID seeds the value until Manny confirms one. */
export const prismaSettings: PushSettings = {
  async getTaxRateId() {
    return (await getSetting(TAX_RATE_KEY)) || process.env.JOBBER_TAX_RATE_ID || null;
  },
  async setTaxRateId(id, label) {
    await setSetting(TAX_RATE_KEY, id);
    if (label) await setSetting(TAX_RATE_LABEL_KEY, label);
  },
};

export async function getQuoteRef(estimateId: string): Promise<string | null> {
  return getSetting(QUOTE_REF_PREFIX + estimateId);
}

export async function setQuoteRef(estimateId: string, quoteRef: string): Promise<void> {
  await setSetting(QUOTE_REF_PREFIX + estimateId, quoteRef);
}

export const playbookStore = new FilePlaybookStore();

export function transport() {
  return defaultTransport();
}
