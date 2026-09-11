param(
  [int]$Port = 3000
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

if (-not (Test-Path $cloudflaredPath)) {
  Write-Error "cloudflared tidak ditemukan di $cloudflaredPath"
  exit 1
}

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listening) {
  Write-Host "server local belum hidup, menjalankan node index.js lebih dulu..."
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; node index.js"
  Start-Sleep -Seconds 6
}

Write-Host "membuka cloudflare quick tunnel ke http://127.0.0.1:$Port ..."
& $cloudflaredPath tunnel --url "http://127.0.0.1:$Port"
