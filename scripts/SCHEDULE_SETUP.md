# Rate book auto-fill - schedule setup

The app exposes POST /api/cron/ratebook. It researches current market prices for
tasks your rate book has no price for and saves them (tagged "research" so you
can correct them later on the Rate Book screen). Two modes:
- fill: price unpriced stubs. Run daily.
- correct: refresh prices it set before. Run weekly, say Monday.

It needs the app running and the cloud brain on (it uses Claude web search).

## Easiest: the in-app button
Open the Rate Book screen and click "Auto-fill 15 from web". No setup, fills 15
at a time. Good for filling the book by hand a chunk at a time.

## Hands-off: Windows Task Scheduler
1. In .env set CRON_SECRET to a long random string. Also set a Windows system
   environment variable CRON_SECRET to the same value (so the script can read it).
2. Open Task Scheduler, Create Task.
   - Daily fill: Trigger daily at, say, 6am. Action: Start a program.
     Program: powershell
     Arguments: -ExecutionPolicy Bypass -File "C:\Claude\handoff\scripts\ratebook-autofill.ps1" fill
   - Weekly correction: Trigger weekly on Monday at 6am. Same program.
     Arguments: ... ratebook-autofill.ps1 correct
3. Make sure the app (the launcher) is running when the task fires. If the app
   runs on your machine, keep it open or set the launcher to start at login.

## When deployed to the cloud (Workstream 8)
Use the host's cron (for example a Vercel cron or any scheduler) to POST to
/api/cron/ratebook with the x-cron-key header set to CRON_SECRET. Same endpoint,
no machine needs to stay on.
