# Vee API update — run ONCE on the VPS via RDP (Administrator PowerShell)
# 2026-10-14: FCM DIRECT — OneSignal dropped, Firebase Cloud Messaging direct.
# Downloads the latest API bundle and restarts.
$ErrorActionPreference = "Stop"
$repo = "https://raw.githubusercontent.com/sumon573/Updated-vee-code/working-2026-10-13-clean/artifacts/deploy-api/api-index.mjs"
$dest = "C:\vee-deploy\index.mjs"
$backup = "C:\vee-deploy\index.mjs.backup-20261014-fcm"
Write-Host "Backing up current API..."
Copy-Item $dest $backup -Force
Write-Host "Downloading updated API bundle (FCM direct)..."
Invoke-WebRequest -Uri $repo -OutFile $dest -UseBasicParsing
Write-Host "Restarting VeeApi..."
# 2026-10-13: Restart-ScheduledTask doesn't exist on this PS version — use Stop/Start
Stop-ScheduledTask -TaskName "VeeApi" -ErrorAction SilentlyContinue
Start-Sleep 3
Start-ScheduledTask -TaskName "VeeApi"
Start-Sleep 5
$proc = Get-Process node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) { Write-Host "OK: API running (PID $($proc.Id))" } else { Write-Host "WARNING: node not running!" }
Write-Host "Done. Backup at $backup"
