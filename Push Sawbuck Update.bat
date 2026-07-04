@echo off
setlocal
REM One-click deploy for Sawbuck: BUILD, sync the learning log, commit, and push
REM (which triggers the Render deploy). The build runs FIRST as a safety gate --
REM if it fails, nothing is committed or pushed, so a broken build never reaches
REM Render. Optionally starts the app locally with the build it just made.
cd /d "%~dp0"

echo Stopping any running Sawbuck instance first (it locks files and blocks the build/push)...
taskkill /F /IM node.exe /T >nul 2>&1
echo Done.
echo.

echo ============================================================
echo  Building Sawbuck (npm run build) - this can take a minute
echo ============================================================
call npm run build
if errorlevel 1 (
  echo.
  echo *** BUILD FAILED. Nothing was committed or pushed. ***
  echo Fix the errors listed above, then run this again.
  echo.
  pause
  exit /b 1
)
echo.
echo Build succeeded.
echo.

REM Clear a stale git lock (safe: node was stopped above, nothing can hold it).
if exist ".git\index.lock" (
  echo Removing stale git lock file...
  del /f ".git\index.lock"
)
echo.

REM Pull Render's learning log, union-merge it into the local copy, push it back,
REM all in one call. Best effort: if the sync is not configured (.env.sync) or
REM Render is unreachable, it just skips and we push anyway.
echo Syncing the shared learning log with Render...
node "scripts\memory-sync.mjs"
echo.

echo Files being committed:
REM Stage everything (db backups, secrets, and node_modules are excluded by
REM .gitignore). This makes sure config changes like package.json actually ship,
REM instead of being silently left out of a hardcoded file list.
git add -A
git status --short
echo.

set "MSG=Go"
set /p "MSG=Commit message (Enter for Go): "
git commit -m "%MSG%"

echo.
git push origin main
if errorlevel 1 (
  echo.
  echo *** git push failed ^(network or auth^). Skipping the Render deploy. ***
) else (
  echo.
  echo Triggering the Render deploy...
  node "scripts\render-deploy.mjs"
)
echo.
echo ============================================================
echo  Done. Build passed, changes pushed, Render deploy triggered.
echo ============================================================
echo.

set "RUN=Y"
set /p "RUN=Start Sawbuck locally now with this build? (Y/N, Enter for Y): "
if /i "%RUN%"=="Y" (
  echo Starting Sawbuck (using the build we just made, no rebuild)...
  start "Sawbuck" cmd /c "npm run start"
  timeout /t 4 >nul
  start "" "http://localhost:3000"
) else (
  echo Skipped. Run "Start Sawbuck.vbs" whenever you want it back up.
)
echo.
pause
endlocal
