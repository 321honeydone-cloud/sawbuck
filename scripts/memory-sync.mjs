#!/usr/bin/env node
// One-command shared-brain sync (local <-> Render), run by Push Sawbuck Update.bat.
//
// It reads the local SAWBUCK_MEMORY.md, POSTs it to Render's /api/memory/sync,
// which union-merges it into Render's copy and returns the combined log. We write
// that combined log back to the local file. After this, the local file, Render's
// /data copy, and (once committed) git all hold the same merged learning. No log
// entry is lost because the server merges instead of overwriting.
//
// Config (put in a gitignored .env.sync at the repo root, or real env vars):
//   SYNC_REMOTE_URL=https://your-sawbuck.onrender.com
//   SYNC_SECRET=the-same-secret-you-set-on-render
// If either is missing, the sync is skipped and the push continues normally.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function loadDotEnvSync() {
  try {
    const text = await readFile(path.join(process.cwd(), ".env.sync"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env.sync, rely on real env vars */
  }
}

async function main() {
  await loadDotEnvSync();
  const remote = (process.env.SYNC_REMOTE_URL || "").replace(/\/$/, "");
  const key = process.env.SYNC_SECRET || "";
  const localPath = process.env.SAWBUCK_MEMORY_PATH || path.join(process.cwd(), "SAWBUCK_MEMORY.md");

  if (!remote || !key) {
    console.log("[memory-sync] SYNC_REMOTE_URL / SYNC_SECRET not set; skipping (push continues).");
    return;
  }

  const local = await readFile(localPath, "utf8").catch(() => "");
  if (!local) {
    console.log("[memory-sync] no local memory file yet; skipping.");
    return;
  }

  let res;
  try {
    res = await fetch(`${remote}/api/memory/sync`, {
      method: "POST",
      headers: { "content-type": "text/markdown", "x-sync-key": key },
      body: local,
    });
  } catch (e) {
    console.log("[memory-sync] could not reach Render (" + e.message + "); skipping.");
    return;
  }

  if (!res.ok) {
    console.log(`[memory-sync] Render returned ${res.status}; leaving local as-is.`);
    return;
  }

  const merged = await res.text();
  if (merged && merged.includes("<!-- log:")) {
    await writeFile(localPath, merged, "utf8");
    console.log("[memory-sync] local + Render learning logs merged. Both are in sync.");
  } else {
    console.log("[memory-sync] Render sent an unexpected response; local left unchanged.");
  }
}

main().finally(() => process.exit(0));
