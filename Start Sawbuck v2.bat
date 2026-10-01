@echo off
title Sawbuck v2
REM Runs the new Sawbuck (the /v2 screens) from whatever folder this file is in,
REM for example E:\sawbuck_v2. Port 3001 so the classic app can keep 3000.
REM Shares the HTTPS Tailscale address so phones can install it from Chrome.
cd /d "%~dp0"

if not exist "node_modules\next" (
  echo First-time setup. Installing, this happens only once...
  call npm install
)

echo Updating the database...
call npx prisma db push

echo.
echo Building Sawbuck v2. This takes about a minute, please wait...
if exist ".next" rmdir /s /q ".next"
call npm run build
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  BUILD FAILED. Copy the red text above this line and send it.
  echo ============================================================
  pause
  exit /b 1
)

echo.
echo Sharing it over Tailscale at https://^<this-pc^>.^<tailnet^>.ts.net:8443/v2
tailscale serve --bg --https=8443 http://localhost:3001 >nul 2>&1
if errorlevel 1 echo (Tailscale serve did not start. The app still runs at http://localhost:3001/v2)

echo.
echo Starting Sawbuck v2 on http://localhost:3001/v2
echo Keep this window open while you use the app. Close it to quit.
echo.
call npx next start -p 3001
