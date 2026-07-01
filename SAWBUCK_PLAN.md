# Sawbuck AI - Master Plan

Last updated: 2026-06-22. Drop this into a new chat ("read SAWBUCK_PLAN.md in the handoff folder") to pick up the roadmap cold. Pair it with HANDOFF.md for the technical state.

## End goal
A functional, user friendly Sawbuck AI that other trade members can use every day and give feedback on. Desktop and phone. Runs in the cloud so anyone can sign up with an email and log in, no install. The AI crew (Boss plus trade agents) actually works and you can watch it work.

## Decisions locked (2026-06-22)
- How it runs: cloud hosted, log in with email, small per-use AI cost. This is what makes sign-up, web pricing search, watchable agents, and the phone app all work cleanly.
- Phone: installable web app (PWA) first. One codebase for desktop and phone, camera and mic work, fastest into your hands. Native iOS/Android only later if the app stores become necessary.
- Sign-up: open email sign-up. Anyone can register and start.
- First chunk to build: Agents you can see.

## The big shift under all of this
Today the brain runs only on your PC through Ollama (free, private, but it does not travel). To hand this to others, the brain moves to a hosted AI. The app was originally built on Claude before the Ollama swap, so the cloud path is recoverable, not a rebuild. That migration lives inside Workstream 1 because the agents cannot be reliable for other people until it is done.

## Why the agents feel broken today
The crew code is real. A Boss reads each request, sends photos to a Vision worker, then hands to the Estimator, and it already narrates each handoff as a trace when an admin is signed in. Two runtime reasons it falls flat:
1. The whole brain needs Ollama running on the machine. If it is not up, the quote comes back thin and silent.
2. The vision model name in the code is gemma4:26B, which is not a real Ollama tag. So photo reading likely never worked. Moving to the cloud brain fixes both.

## How we work to keep this sane
One workstream per session. Each is self contained so we never blow up tokens. Start a session with "read SAWBUCK_PLAN.md, we are doing Workstream N." Finish each with a quick verify before moving on.

---

## Workstream 1 - Agents you can see (FIRST)  [IN PROGRESS, cloud brain shipped 2026-06-22]
Status: DONE pending a Windows build. Cloud brain live (client.ts provider abstraction), vision works on Claude, trade routing + admin trace, everyone-visible crew badge, the intake box (what you need + timeframe), a live Pricing Research agent (web median pricing, auto-fills the book), and a Boss QA pass that checks the crew's work and fills blank prices all shipped 2026-06-22. Relaunch on Windows to verify.

## Workstream 1 - Agents you can see (FIRST)
Goal: the crew works for everyone and you can watch it route.
- Move the brain off local-only Ollama to a hosted model (revive the Claude path, keep an Ollama option for your shop power mode).
- Fix the vision model so photos actually get read.
- Build the main intake box: "here is what I need, here is my timeframe." The Boss reads that and dispatches.
- Route into trade crews (carpentry, drywall, tile and wet areas, fixtures, pressure washing, decks and fences, a general service agent). Each is a function the Boss can call by trade, which keeps the code simple.
- Live agent view: show which agent did what, on the admin side at minimum, ideally a small badge in the chat for everyone.
Key files: src/lib/agents/boss.ts, src/lib/agents/client.ts (the wire to the model), estimator.ts, vision.ts, src/app/api/chat/route.ts.
Done when: a request with a timeframe routes to the right trade agent, photos get read, and the admin can see the handoffs.

## Workstream 2 - Quote sheet + chat cleanup  [DONE 2026-06-22, pending Windows build]
Shipped: line items back to aligned columns and rows with a labeled header (dropdown kept), the chat thread now persists and restores on reload, the AI gets the last 8 turns as memory, and a mic button for voice input. Relaunch on Windows to verify.

## Workstream 2 - Quote sheet + chat cleanup
Goal: easy to read quote, real conversation.
- Line items back to clean columns and rows: Qty, Unit, Unit cost, Total. The condensed "1 each $ 60" string is hard to read.
- Keep the dropdown breakdown exactly as is. You like it.
- Chat becomes a real scrolling conversation that remembers where you left off, so you can re-check measurements by asking.
- Mic button next to the attach icon for voice input.
Key files: src/components/EstimateSheet.tsx, src/components/ChatPanel.tsx, src/components/Workspace.tsx.
Done when: the sheet reads cleanly, the chat scrolls with full history, and you can talk to it.

## Workstream 3 - Exclusions + Finalize  [DONE 2026-06-22, pending Windows build]
Shipped: Jobber button renamed Finalize, editable exclusions with checkmark strike-out and add-your-own, exclusions persist and grow with the quote by trade, Copy quote outputs scope + price + checked exclusions. Relaunch on Windows to verify.

## Workstream 3 - Exclusions + Finalize
Goal: exclusions that build themselves, one clean finalize.
- Exclusions list builds as the quote grows and as line items are added or requested.
- Checkmark strikes an exclusion out to remove it, same pattern as the include checkbox.
- Show exclusions to the user so they can add or subtract.
- Rename the Jobber button to Finalize. It outputs scope of work plus price plus exclusions only, nothing internal.
Key files: src/components/JobberModal.tsx, src/lib/jobber.ts, src/app/api/jobber/route.ts.
Done when: exclusions grow with the quote, can be struck out, and Finalize produces scope + price + exclusions.

## Workstream 4 - Inspection to quote  [DONE 2026-06-22, pending Windows build]
Shipped: drag-and-drop drop zone, a prominent in-flow Create Estimate button, photos plus defect/risk/recommendation carried into the quote breakdown, and a clearer Excluded badge. Phone capture covered by the drop zone and camera inputs, full native flow is WS8. Relaunch on Windows to verify.

## Workstream 4 - Inspection to quote
Goal: dead simple capture, findings flow into the quote.
- Drag and drop drop zone for photos and videos.
- Move Create Estimate into the card right after Add issue, so it is not buried at the bottom.
- Make the include checkbox actually do something visible (it currently sends to code with no feedback on screen).
- Push each photo plus its defect, risk, and recommendation into the quote for the user to see.
- Phone capture: shoot a photo or video and talk, and it summarizes into the quote.
Key files: src/components/InspectionWorkspace.tsx, src/app/api/scout/route.ts, src/app/api/inspection/convert/route.ts.
Done when: you can drop media, find Create Estimate easily, the checkbox visibly works, and findings land in the quote.

## Workstream 5 - Accounts + Ask AI memory  [DONE 2026-06-22, pending Windows build + db push]
Shipped: open email sign-up and email/password login (PIN still works for the owner and crew), passwords hashed with PBKDF2. Per-account scoping for quotes, inspections, and chat was already in place. Needs npx prisma db push on relaunch (launcher does it). Relaunch on Windows to verify.

## Workstream 5 - Accounts + Ask AI memory
Goal: anyone signs up, everything is theirs and saved.
- Open email sign-up and login.
- Each account sees only its own quotes and inspections.
- Ask AI history saved per account and per quote, so you return and pick up where you left off.
Key files: src/lib/auth.ts, src/middleware.ts, src/app/login/page.tsx, prisma/schema.prisma (add email), src/app/api/chat/route.ts (persist threads).
Done when: a new email can register, log in, and find their saved quotes and chat.

## Workstream 6 - Admin dashboard + feedback  [DONE 2026-06-22, pending Windows build + db push]
Shipped: per-quote glance summary (asked, turns, price pushback) plus a lazy AI gist button, a feedback channel (floating button on every screen, admin reads them on the Admin page), and a cleaned-up quotes history with colored status, client name, and running totals. Needs npx prisma db push on relaunch. Relaunch on Windows to verify.

## Workstream 6 - Admin dashboard + feedback
Goal: the control room, summaries not transcripts.
- Admin sees all accounts and their quotes (this part exists in CrewQuotes).
- Each quote gets a short auto-summary: what it was, the main question, how many edits, any "too expensive" moments, the gist of the conversation. Not the full transcript.
- Add a feedback channel from users (none exists today).
- Clean up the Quotes history view.
Key files: src/app/admin/page.tsx, src/components/CrewQuotes.tsx, src/components/QuoteList.tsx, src/app/history/page.tsx, plus a new summary endpoint.
Done when: each quote shows a one-glance summary and users can send feedback.

## Workstream 7 - Rate book auto-fill  [DONE 2026-06-22, pending Windows build]
A Pricing Research agent now goes to the web (Claude web search) at estimate time to price tasks the book cannot, and auto-fills the book (admin only, tagged source research). Still to do here: the scheduled daily fill, weekly correction pass, and the Monday bulk search.

## Workstream 7 - Rate book auto-fill
Goal: fill the book, keep it current.
- Fill the 696 unpriced stubs.
- Daily task fills entries, weekly pass corrects them.
- Monday web pricing search (Reddit, handyman pricing sites) writes current costs into the right book, corrected later if it does not match how Sawbuck prices.
- Keep the engine guard so blank or 0 prices never leak into a quote.
Key files: src/lib/rateOverrides.ts, src/app/api/ratebook/learn/route.ts, src/data/rate_book.json, plus a scheduled job.
Done when: the book fills on a schedule and Monday search adds priced entries safely.

## Workstream 8 - Mobile + distribution + pilot feedback  [DONE 2026-06-22, pending Windows build + your hosting]
Shipped: mobile polish (quote table reflows on phones), uploads made volume-ready via UPLOAD_DIR, and Path A deploy artifacts (Dockerfile, .env.production.example, DEPLOY.md quickstart, cron scheduler). Deploy itself is yours to run from DEPLOY.md. Managed/serverless path left for later if it grows.

## Workstream 8 - Mobile + distribution + pilot feedback
Goal: in real hands, learning from use.
- Polish the PWA for phone (capture, mic, layout).
- Deploy the cloud version.
- Hand it to trade members, collect feedback for daily-use fixes.
- Native app only if app stores become necessary.
Done when: trade members are using it on phones and feedback is flowing back.

---

## Suggested order
1 (agents + cloud) is first and is the foundation. Then 5 (accounts) since cloud and sign-up pair naturally. Then 2 and 3 and 4 (the daily quote and inspection experience). Then 6 (admin and feedback) once there is real usage to summarize. 7 (rate book) can run in parallel as a background job whenever. 8 (rollout) closes it out, though we can soft-launch earlier.
