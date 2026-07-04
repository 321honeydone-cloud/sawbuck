#!/usr/bin/env node
// Fire the Render deploy hook so a deploy happens on every push, even if the
// Render dashboard's Auto-Deploy toggle is off. Get the hook URL from your
// Render service: Settings -> Deploy Hook -> copy the URL, then put it in the
// gitignored .env.sync at the repo root as:
//   RENDER_DEPLOY_HOOK=https://api.render.com/deploy/srv-xxxx?key=yyyy
// If it is not set, this just skips and you fall back to Render auto-deploy.

import { readFile } from "node:fs/promises";
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
  const hook = (process.env.RENDER_DEPLOY_HOOK || "").trim();
  if (!hook) {
    console.log("[render-deploy] RENDER_DEPLOY_HOOK not set in .env.sync; skipping (relying on Render auto-deploy).");
    return;
  }
  try {
    const res = await fetch(hook, { method: "POST" });
    if (res.ok) {
      console.log("[render-deploy] Deploy hook fired -- Render is now building the new commit.");
    } else {
      console.log(`[render-deploy] Deploy hook returned ${res.status}. Double-check the URL in .env.sync.`);
    }
  } catch (e) {
    console.log("[render-deploy] Could not reach the deploy hook: " + e.message);
  }
}

main().finally(() => process.exit(0));
