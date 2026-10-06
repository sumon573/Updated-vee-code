# Vee API update — run ONCE on the VPS via RDP (Administrator PowerShell)
# Downloads the fixed API bundle and restarts the service.
$ErrorActionPreference = "Stop"
$repo = "https://raw.githubusercontent.com/sumon573/Updated-vee-code/master/artifacts/deploy-api/api-index.mjs"
$dest = "C:\vee-api\dist\index.mjs"
Write-Host "Downloading fixed API bundle..."
Invoke-WebRequest -Uri $repo -OutFile $dest -UseBasicParsing
Write-Host "Restarting VeeApi service..."
Restart-ScheduledTask -TaskName "VeeApi"
Start-Sleep 5
$proc = Get-Process node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) { Write-Host "OK: API running (PID $($proc.Id))" } else { Write-Host "WARNING: node not running!" }
