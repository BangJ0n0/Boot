param(
  [int]$Port = 3000
)

$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

if (-not (Test-Path $cloudflaredPath)) {
  Write-Error "cloudflared tidak ditemukan di $cloudflaredPath"
  exit 1
}

Write-Host "membuka cloudflare quick tunnel ke http://127.0.0.1:$Port ..."
& $cloudflaredPath tunnel --url "http://127.0.0.1:$Port"
