$localVer = if (Test-Path "C:\vee-api\version.txt") { (Get-Content "C:\vee-api\version.txt").Trim() } else { "" }
try {
    $remoteVer = (iwr -Uri "https://raw.githubusercontent.com/sumon573/Updated-vee-code/master/api-server/dist/version.txt" -UseBasicParsing -TimeoutSec 30).Content.Trim()
} catch { exit 0 }
if ($remoteVer -ne $localVer -and $remoteVer -ne "") {
    schtasks /end /tn "VeeApi" 2>$null | Out-Null
    Start-Sleep 3
    try {
        iwr -Uri "https://raw.githubusercontent.com/sumon573/Updated-vee-code/master/api-server/dist/index.mjs" -OutFile "C:\vee-api\index.mjs" -UseBasicParsing -TimeoutSec 120
        $remoteVer | Out-File "C:\vee-api\version.txt" -NoNewline
    } catch { }
    schtasks /run /tn "VeeApi" 2>$null | Out-Null
}
