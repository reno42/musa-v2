# fetch_logos_fix.ps1 — Re-fetch the logos that got stale-temp copies in the
# previous pass (kimi/qoder/runway/wavespeed/zed shared one file; windsurf got
# the merged-brand K). Deletes the bad target first; per-attempt temp file is
# removed after every try so stale bytes can never validate.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root "public\logos"
$ua   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
$pngSig = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

function Test-Png([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  $b = [System.IO.File]::ReadAllBytes($path)
  if ($b.Length -le 800) { return $false }
  for ($i = 0; $i -lt 8; $i++) { if ($b[$i] -ne $pngSig[$i]) { return $false } }
  return $true
}

# name -> candidate URLs (s2 = Google favicon index, PNG at sz=128)
$brands = [ordered]@{
  "qoder"     = @(
    "https://www.google.com/s2/favicons?domain=qoder.com&sz=128",
    "https://www.google.com/s2/favicons?domain=qoder.ai&sz=128"
  )
  "runway"    = @(
    "https://www.google.com/s2/favicons?domain=runwayml.com&sz=128",
    "https://www.google.com/s2/favicons?domain=runway.com&sz=128"
  )
  "wavespeed" = @(
    "https://www.google.com/s2/favicons?domain=wavespeed.ai&sz=128"
  )
  "zed"       = @(
    "https://www.google.com/s2/favicons?domain=zed.dev&sz=128"
  )
  "windsurf"  = @(
    "https://www.google.com/s2/favicons?domain=codeium.com&sz=128",
    "https://www.google.com/s2/favicons?domain=windsurf.com&sz=128"
  )
}

foreach ($name in $brands.Keys) {
  $out = Join-Path $dir "$name.png"
  if (Test-Png $out) {
    $h1 = (Get-FileHash $out -Algorithm MD5).Hash
    $h2 = (Get-FileHash (Join-Path $dir "kimi.png") -Algorithm MD5).Hash
    if ($h1 -ne $h2) { Write-Output ("SKIP  {0} (exists, distinct)" -f $name); continue }
  }
  Remove-Item $out -ErrorAction SilentlyContinue
  $ok = $false
  foreach ($url in $brands[$name]) {
    $tmp = Join-Path $env:TEMP ("logo_fix_{0}.bin" -f $name)
    & curl.exe -sSL --fail --max-time 30 -A $ua -o $tmp $url 2>$null
    $curlOk = ($LASTEXITCODE -eq 0)
    $valid = (Test-Png $tmp)
    if ($curlOk -and $valid) {
      Copy-Item $tmp $out -Force
      Write-Output ("OK    {0}  <-  {1}" -f $name, $url)
      $ok = $true
    }
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    if ($ok) { break }
  }
  if (-not $ok) { Write-Output ("MISS  {0}" -f $name) }
}

# ── Final integrity check: no file may equal kimi.png unless it IS kimi ──
$kimiHash = (Get-FileHash (Join-Path $dir "kimi.png") -Algorithm MD5).Hash
Get-ChildItem $dir -Filter *.png | ForEach-Object {
  $h = (Get-FileHash $_.FullName -Algorithm MD5).Hash
  if ($h -eq $kimiHash -and $_.BaseName -ne "kimi") {
    Write-Output ("DUP-BAD  {0} still equals kimi.png" -f $_.Name)
  }
}
Write-Output "---- done"
