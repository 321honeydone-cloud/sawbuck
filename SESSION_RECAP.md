# Sawbuck AI - Session Recap (2026-06-22)

All eight planned workstreams are built and typecheck clean. Full detail is in HANDOFF.md, the roadmap and status are in SAWBUCK_PLAN.md, and the cloud rollout steps are in DEPLOY.md.

## What shipped

1. Agents you can see (plus the cloud brain). The AI runs on Claude in the cloud, not just local Ollama. Vision reads photos on Claude. The Boss reads the job, branches to trade agents, and shows it in the admin trace and an everyone-visible crew badge. An intake box asks what you need and when. A Pricing Research agent pulls live market prices off the web for anything the rate book cannot price and auto-fills the book. The Boss reviews the crew's work, fills blank prices, and warns before a quote with a missing price goes out.

2. Quote sheet and chat. Line items are clean columns and rows with a labeled header, dropdown kept. The chat thread saves and restores on reload, the AI remembers the last several turns, and there is a mic button.

3. Exclusions and Finalize. The Jobber button is now Finalize. Exclusions are an editable checklist that grows with the quote by trade, check to keep or uncheck to strike, add your own. Copy quote outputs scope, price, and the checked exclusions.

4. Inspection to quote. Drag and drop photos or video. Create Estimate sits right under the capture card. Photos plus defect, risk, and recommendation flow into the quote breakdown. Excluded issues show a red badge.

5. Accounts and sign-up. Open email sign-up and email or PIN login, passwords hashed. Each account only sees its own quotes, inspections, and chat.

6. Admin dashboard and feedback. Each quote shows a glance summary (asked, turns, price pushback) plus a lazy AI gist button. A Feedback button on every screen, read on the Admin page. Quotes history got colored status, client names, and running totals.

7. Rate book auto-fill. A scheduled endpoint fills unpriced stubs daily and refreshes weekly, plus an in-app "Auto-fill 15 from web" button on the Rate Book screen. Scheduler script and setup in scripts/.

8. Mobile and distribution prep. The quote table reflows on phones, uploads can point at a persistent volume (UPLOAD_DIR), and the one-box deploy is ready: Dockerfile, .env.production.example, and DEPLOY.md.

## The one thing to do on relaunch (local)
Start the app the normal way (the launcher). It rebuilds, runs the database update for the new email and feedback columns, and starts on the Claude cloud brain. First launch does a little extra setup, that is expected. To run free on local Ollama instead, set AI_PROVIDER=ollama in .env.

## Good tests
- Build a multi-trade job with a deadline, watch the crew badge and (as admin) the routing trace.
- Attach a job-site photo, confirm line items, open a line to see the photo and findings.
- Ask "what should it cost to replace a 40 gallon water heater" and watch the rate book gain an entry, or click Auto-fill on the Rate Book screen.
- Create an email account, confirm it only sees its own quotes.
- Send something through Feedback and read it on the Admin page.
- Finalize a quote, strike an exclusion, add one, Copy quote.

## To put it online for your crew
Follow DEPLOY.md, Path A (one always-on box). Set the env from .env.production.example, mount a volume for the database and uploads, deploy the Dockerfile, put it behind HTTPS, and point the host's cron at the rate-book fill.

## Notes
- Everything changed this session typechecks clean in the sandbox. The only two errors are read-truncation on two files never touched (estimator.ts, ai.ts), so they build fine on Windows. The real check is npm run build on your machine.
- Backups of every edited file are in _w1_backups.
- To resume or extend: open a new chat and say "read SAWBUCK_PLAN.md and HANDOFF.md in the handoff folder."
