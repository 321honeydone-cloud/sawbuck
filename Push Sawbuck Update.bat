@echo off
REM Pushes the bug-fix commit to GitHub (origin/main). If Render is set to
REM auto-deploy from this repo, the push kicks off the deploy too.
cd /d "%~dp0"

echo Stopping any running Sawbuck instance first (it locks files and blocks the push)...
taskkill /F /IM node.exe /T >nul 2>&1
echo Done. Any local Sawbuck server is now stopped.
echo.

REM Clear a stale git lock. Safe here: everything that could hold it was just
REM stopped, so a leftover index.lock is only debris from a crashed git command.
if exist ".git\index.lock" (
  echo Removing stale git lock file...
  del /f ".git\index.lock"
)
echo.

REM Pull Render's learning log, union-merge it into the local copy, and push the
REM merged copy back to Render, all in one call. Best effort: if the sync is not
REM configured (no .env.sync) or Render is unreachable, it just skips and we push
REM anyway. Runs while node is stopped so nothing writes the file underneath us.
echo Syncing the shared learning log with Render...
node "scripts\memory-sync.mjs"
echo.

echo Files being committed:
REM src = the app. The rest ship the shared learning log + its deploy wiring so
REM Render seeds and persists SAWBUCK_MEMORY.md on the /data volume.
git add src "SAWBUCK_MEMORY.md" "docker-start.sh" ".env.production.example" "Push Sawbuck Update.bat" scripts
git status --short
echo.

set MSG=Sawbuck update
set /p MSG=Commit message (Enter for "Go"):
git commit -m "%MSG%"

echo.
git push origin main

echo.
echo Done. If Render auto-deploys from GitHub, the new build is on its way.
echo The local server was stopped for the push. Run "Start Sawbuck.vbs" to
echo bring it back up with the new code.
pause
