# Sawbuck AI - rate book auto-fill. Researches market prices for unpriced tasks
# and writes them into your rate book. Run it on a schedule with Windows Task
# Scheduler. Needs the app running (the launcher) and the cloud brain on.
#
#   powershell -ExecutionPolicy Bypass -File ratebook-autofill.ps1 fill     (daily)
#   powershell -ExecutionPolicy Bypass -File ratebook-autofill.ps1 correct  (weekly, Mondays)
#
# Set CRON_SECRET as a system environment variable to the same value you put in
# .env. If you leave .env CRON_SECRET blank, use the in-app "Auto-fill" button
# on the Rate Book screen instead (this script needs the key).

param([string]$Mode = "fill", [int]$Limit = 15)
$ErrorActionPreference = "Stop"

$key = $env:CRON_SECRET
if (-not $key) {
  Write-Host "CRON_SECRET is not set. Set it (same value as .env) and try again."
  exit 1
}

$body = @{ mode = $Mode; limit = $Limit } | ConvertTo-Json
try {
  $res = Invoke-RestMethod -Uri "http://localhost:3000/api/cron/ratebook" -Method Post `
    -Headers @{ "x-cron-key" = $key; "content-type" = "application/json" } -Body $body
  Write-Host ("Done. Researched {0}, saved {1}." -f $res.researched, $res.saved)
} catch {
  Write-Host ("Auto-fill failed: {0}" -f $_.Exception.Message)
  exit 1
}
