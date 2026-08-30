# fetch_logos_retry.ps1 — Retry the logos the first pass missed.
# Strategy: curl.exe -L (follows 301/308) with a browser UA -> direct
# apple-touch-icons; Google s2 favicon PNG (sz=128) as uniform fallback;
# System.Drawing monogram placeholder as the last resort so the file the
# user replaces always exists at public/logos/<name>.png.
$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root "public\logos"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$pngSig = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
$tmp = Join-Path $env:TEMP "logo_retry.bin"

# name -> direct candidates (google s2 favicon domain appended automatically)
$brands = [ordered]@{
  "codex"     = @{ direct = @(); domain = "openai.com" }
  "cursor"    = @{ direct = @("https://cursor.com/apple-touch-icon.png", "https://www.cursor.com/apple-touch-icon.png"); domain = "cursor.com" }
  "windsurf"  = @{ direct = @("https://windsurf.com/apple-touch-icon.png"); domain = "windsurf.com" }
  "kimi"      = @{ direct = @("https://kimi.com/apple-touch-icon.png"); domain = "kimi.com" }
  "qoder"     = @{ direct = @("https://qoder.com/apple-touch-icon.png"); domain = "qoder.com" }
  "zed"       = @{ direct = @("https://zed.dev/apple-touch-icon.png"); domain = "zed.dev" }
  "runway"    = @{ direct = @("https://runwayml.com/apple-touch-icon.png", "https://runway.com/apple-touch-icon.png"); domain = "runwayml.com" }
  "wavespeed" = @{ direct = @("https://wavespeed.ai/apple-touch-icon.png"); domain = "wavespeed.ai" }
  "quiver"    = @{ direct = @(); domain = "" }   # internal brand — placeholder only
  "unsplash"  = @{ direct = @("https://unsplash.com/apple-touch-icon.png", "https://unsplash.com/apple-touch-icon-precomposed.png"); domain = "unsplash.com" }
}

function Test-Png([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  $b = [System.IO.File]::ReadAllBytes($path)
  if ($b.Length -le 500) { return $false }
  for ($i = 0; $i -lt 8; $i++) { if ($b[$i] -ne $pngSig[$i]) { return $false } }
  return $true
}

$missing = @()
foreach ($name in $brands.Keys) {
  $out = Join-Path $dir "$name.png"
  if (Test-Png $out) { Write-Output ("SKIP  {0} (already ok)" -f $name); continue }
  $ok = $false

  foreach ($url in $brands[$name].direct) {
    & curl.exe -sSL --fail --max-time 30 -A $ua -o $tmp $url 2>$null
    if (Test-Png $tmp) { Copy-Item $tmp $out -Force; Write-Output ("OK    {0}  <-  {1}" -f $name, $url); $ok = $true; break }
  }
  if (-not $ok -and $brands[$name].domain -ne "") {
    $s2 = "https://www.google.com/s2/favicons?domain={0}&sz=128" -f $brands[$name].domain
    & curl.exe -sSL --fail --max-time 30 -A $ua -o $tmp $s2 2>$null
    if (Test-Png $tmp) { Copy-Item $tmp $out -Force; Write-Output ("OK    {0}  <-  {1}" -f $name, $s2); $ok = $true }
  }
  if (-not $ok) { Write-Output ("MISS  {0}" -f $name); $missing += $name }
}

# ── Placeholders: monogram on transparent 512px, so the replace-me file exists ──
if ($missing.Count -gt 0) {
  Add-Type -AssemblyName System.Drawing
  foreach ($name in $missing) {
    $out = Join-Path $dir "$name.png"
    $bmp = New-Object System.Drawing.Bitmap 512, 512
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $font = New-Object System.Drawing.Font("Segoe UI", 220, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 196, 181, 253))
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $initial = $name.Substring(0, 1).ToUpper()
    $box = New-Object System.Drawing.RectangleF 0, 0, 512, 512
    $g.DrawString($initial, $font, $brush, $box, $fmt)
    $g.Dispose(); $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Write-Output ("PLACEHOLDER  {0} -> {1}" -f $name, $out)
  }
}
Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Output "---- done"
