# Vee API update — run ONCE on the VPS via RDP (Administrator PowerShell)
# Downloads the latest API bundle (with muted-chat push fix) and restarts.
$ErrorActionPreference = "Stop"
$repo = "https://raw.githubusercontent.com/sumon573/Updated-vee-code/working-2026-10-13-clean/artifacts/deploy-api/api-index.mjs"
$dest = "C:\vee-deploy\index.mjs"
$backup = "C:\vee-deploy\index.mjs.backup-20261013-mute"
Write-Host "Backing up current API..."
Copy-Item $dest $backup -Force
Write-Host "Downloading updated API bundle..."
Invoke-WebRequest -Uri $repo -OutFile $dest -UseBasicParsing
Write-Host "Restarting VeeApi service..."
Restart-ScheduledTask -TaskName "VeeApi"
Start-Sleep 5
$proc = Get-Process node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) { Write-Host "OK: API running (PID $($proc.Id))" } else { Write-Host "WARNING: node not running!" }
Write-Host "Done. Backup at $backup"
