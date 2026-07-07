// One-time bulk import of the 2026 ratebook prices into the live overrides row.
//
// Runs on container boot (see docker-start.sh). Idempotent: it records a marker
// in AppSetting and skips on later boots, so it loads exactly once per version.
// Safe by construction: it never clobbers a task a human edited on the Rate Book
// screen (source "screen") or a price learned from a real quote (source "quote"),
// and it never throws out of the process (a failure here must not block app boot).
//
// The prices live in the DB (the gitignored SQLite file on the /data volume), so
// they do not travel with a git deploy. This script + the committed payload
// (src/data/ratebook_overrides_2026.json) are how they reach Render.

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const OVERRIDES_ID = "CATALOG-RATE-OVERRIDES";
const OVERRIDES_NAME = "Rate Book Overrides";
const MARKER_KEY = "ratebook_bulk_load";
const PRESERVE = new Set(["screen", "quote"]);

async function main() {
  const prisma = new PrismaClient();
  try {
    const payload = JSON.parse(
      readFileSync(new URL("../src/data/ratebook_overrides_2026.json", import.meta.url), "utf8")
    );
    const version = payload.version || "v1";

    // Idempotency: skip if this version already loaded.
    const marker = await prisma.appSetting.findUnique({ where: { key: MARKER_KEY } }).catch(() => null);
    if (marker && marker.value === version) {
      console.log(`[ratebook-load] version ${version} already loaded, skipping.`);
      return;
    }

    const row = await prisma.catalog.findUnique({ where: { id: OVERRIDES_ID } });
    let overrides = {};
    if (row?.items) {
      try { const o = JSON.parse(row.items); if (o && typeof o === "object" && !Array.isArray(o)) overrides = o; } catch { overrides = {}; }
    }

    let added = 0, updated = 0, skipped = 0;
    const now = new Date().toISOString();
    for (const p of payload.overrides) {
      const ex = overrides[p.name];
      if (ex && PRESERVE.has(ex.source)) { skipped++; continue; }
      if (ex) updated++; else added++;
      overrides[p.name] = {
        name: p.name,
        final_price: p.final_price,
        unit: p.unit,
        labor_minutes: p.labor_minutes ?? null,
        material_allowance: p.material_allowance ?? null,
        source: "ratebook_2026",
        updatedAt: now,
      };
    }

    const blob = JSON.stringify(overrides);
    await prisma.catalog.upsert({
      where: { id: OVERRIDES_ID },
      update: { items: blob },
      create: { id: OVERRIDES_ID, name: OVERRIDES_NAME, type: "mixed", items: blob },
    });
    await prisma.appSetting.upsert({
      where: { key: MARKER_KEY },
      update: { value: version },
      create: { key: MARKER_KEY, value: version },
    });
    console.log(`[ratebook-load] version ${version} loaded: added ${added}, updated ${updated}, preserved ${skipped}. total overrides ${Object.keys(overrides).length}.`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((e) => {
  // Never block boot on a load failure.
  console.error("[ratebook-load] failed (app boot continues):", e?.message || e);
  process.exit(0);
});
