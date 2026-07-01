# Sawbuck AI - deploy + distribution guide (Workstream 8)

This is what it takes to put Sawbuck online so you can hand it to other trade members. The phone app is already covered: it installs as an app (PWA) and the screens are mobile-friendly. The remaining piece is hosting.

## What the app needs to run
- A Node host that runs `next build` then `next start`.
- Environment variables: ANTHROPIC_API_KEY (the cloud brain), AUTH_TOKEN (a long random string, the cookie + hash secret), APP_PINS (owner PIN), AI_PROVIDER=claude, and CRON_SECRET (for the scheduled rate-book fill).
- A database (today this is a local SQLite file).
- A place for uploaded photos and video (today this is the local public/uploads folder).
- HTTPS, so the secure login cookie works.

## Two ways to host it

### Path A - one always-on box (simplest, recommended to start)
Run it on a single always-on host that keeps a real disk: a small VPS, or a service like Render, Railway, or Fly. Keep SQLite and local uploads as they are. Almost no code change.
- Pros: closest to what you have, cheapest, fastest to get live, fine for a handful of users.
- Cons: one machine, you keep an eye on it, backups are on you (copy the SQLite file).
- Steps: set the env vars, point the host at the repo, build and start, attach a persistent disk for the SQLite file and the uploads folder, set the host's scheduler to hit /api/cron/ratebook daily.

### Path B - managed / serverless (Vercel and similar, scales further)
Serverless hosts do not keep a local disk, so two things have to move:
- Database: switch Prisma from sqlite to Postgres (a managed Postgres like Neon or Supabase). This is a datasource change plus a migration, the app code barely changes since it all goes through Prisma.
- Uploads: store photos and video in object storage (S3, Cloudflare R2) instead of public/uploads, which means a small change to the upload route and the scout frame reader.
- Cron: use the host's cron to hit /api/cron/ratebook.
- Pros: scales, no machine to babysit, easy rollbacks.
- Cons: more setup, the Postgres and storage migration is real work.

## Recommendation
For handing it to a few trade members to use daily and give feedback, start with Path A. It gets you live fastest with the least change, and you can move to Path B later if usage grows. Either way the per-use AI cost is the same.

## Pre-launch checklist (both paths)
- Set a strong AUTH_TOKEN (not the dev default).
- Set ANTHROPIC_API_KEY and AI_PROVIDER=claude.
- Set CRON_SECRET and wire the daily fill (see scripts/SCHEDULE_SETUP.md).
- Make sure it is served over HTTPS.
- Run the database migration on first deploy (db push or migrate).
- Confirm sign-up, a quote build with a photo, Finalize, and the admin view on the live URL.

## Distribution + feedback
- Send trade members the URL. They sign up with their email (open sign-up is on).
- You see everyone's quotes and their feedback on the Admin page. The Feedback button is on every screen for them.
- Watch the per-quote summaries and the Feedback section for what to fix first.

## Path A quickstart (Docker, added 2026-06-22)
The repo now ships a Dockerfile, .dockerignore, and .env.production.example for the one-box path.
1. Copy .env.production.example into your host's environment settings and fill it in. Set a long random AUTH_TOKEN and CRON_SECRET, your ANTHROPIC_API_KEY, and your APP_PINS.
2. Attach a persistent volume (for example mounted at /data) and set DATABASE_URL=file:/data/sawbuck.db and UPLOAD_DIR=/data/uploads. Both the database and uploaded photos/video now live there, so redeploys do not wipe them. UPLOAD_DIR is read by the upload, media, and scout routes through src/lib/uploads.ts.
3. Deploy the Dockerfile. On boot it runs prisma db push (creates the email and feedback columns) then next start on PORT (default 3000).
4. Put it behind HTTPS (most hosts do this for you). The login cookie is secure-only in production, so HTTPS is required.
5. Set the host's cron to POST /api/cron/ratebook daily with header x-cron-key = CRON_SECRET (see scripts/SCHEDULE_SETUP.md).
6. Smoke test on the live URL: sign up, build a quote with a photo, Finalize, check the Admin page and Feedback.

ffmpeg is installed in the image so inspection videos get read. Without it, photos still work and clips are skipped.
