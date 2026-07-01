@echo off
title HoneyDone Estimating
cd /d "C:\Claude\handoff"

if not exist "node_modules\next" (
  echo First-time setup. Installing, this happens only once...
  call npm install
)

echo Updating the database...
call npx prisma db push

echo.
echo Clearing the old build cache...
if exist ".next" rmdir /s /q ".next"

echo.
echo Building HoneyDone. This takes about a minute the first time, please wait...
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
echo Starting HoneyDone. A browser tab opens shortly.
echo Keep this window open while you use the app. Close it to quit.
echo.
start "" /min cmd /c "timeout /t 4 >nul & start "" http://localhost:3000"
call npm run start
