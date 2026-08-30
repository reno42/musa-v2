# fetch_logos.ps1 — Download integration/agent brand logos into public/logos/.
# Tries each candidate URL in order; keeps the first response that is a real
# PNG (magic-byte check). Brands with no candidates become placeholder jobs.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot   # repo root
$dir  = Join-Path $root "public\logos"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$brands = [ordered]@{
  "claude"     = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Claude_AI_logo.svg?width=512",
    "https://claude.ai/apple-touch-icon.png"
  )
  "chatgpt"    = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/ChatGPT_logo.svg?width=512",
    "https://chatgpt.com/apple-touch-icon.png"
  )
  "codex"      = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/OpenAI_Codex_logo.svg?width=512",
    "https://raw.githubusercontent.com/openai/codex/main/docs/assets/codex.png"
  )
  "cursor"     = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Cursor_Logo.svg?width=512",
    "https://www.cursor.com/apple-touch-icon.png"
  )
  "copilot"    = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/GitHub_Copilot_logo.svg?width=512",
    "https://github.githubassets.com/images/modules/site/copilot-icon.png"
  )
  "windsurf"   = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Windsurf_logo.svg?width=512",
    "https://windsurf.com/apple-touch-icon.png"
  )
  "gemini"     = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Google_Gemini_logo.svg?width=512",
    "https://gemini.google.com/apple-touch-icon.png"
  )
  "gemini-cli" = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Google_Gemini_logo.svg?width=512",
    "https://gemini.google.com/apple-touch-icon.png"
  )
  "kimi"       = @(
    "https://www.kimi.com/apple-touch-icon.png",
    "https://kimi.moonshot.cn/apple-touch-icon.png"
  )
  "qoder"      = @(
    "https://qoder.com/apple-touch-icon.png",
    "https://www.qoder.com/apple-touch-icon.png"
  )
  "openclaw"   = @(
    "https://openclaw.ai/apple-touch-icon.png",
    "https://openclaw.com/apple-touch-icon.png"
  )
  "zed"        = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Zed_editor_logo.svg?width=512",
    "https://zed.dev/apple-touch-icon.png"
  )
  "deepseek"   = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/DeepSeek_logo.svg?width=512",
    "https://www.deepseek.com/apple-touch-icon.png"
  )
  "openrouter" = @(
    "https://openrouter.ai/apple-touch-icon.png",
    "https://openrouter.ai/static/img/logo.png"
  )
  "runway"     = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Runway_AI_logo.svg?width=512",
    "https://commons.wikimedia.org/wiki/Special:FilePath/RunwayML_logo.svg?width=512",
    "https://runwayml.com/apple-touch-icon.png"
  )
  "wavespeed"  = @(
    "https://wavespeed.ai/apple-touch-icon.png",
    "https://www.wavespeed.ai/apple-touch-icon.png"
  )
  "quiver"     = @()
  "unsplash"   = @(
    "https://commons.wikimedia.org/wiki/Special:FilePath/Unsplash_Logo.svg?width=512",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Unsplash_logo.svg?width=512",
    "https://unsplash.com/apple-touch-icon.png"
  )
}

$pngSig = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
$failed = @()
$tmp = Join-Path $env:TEMP "logo_dl.bin"

foreach ($name in $brands.Keys) {
  $out = Join-Path $dir "$name.png"
  $ok = $false
  foreach ($url in $brands[$name]) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 25 `
        -Headers @{ "User-Agent" = "MusaByFuturaria/1.0 (logo fetch; repo build script)" }
      $bytes = [System.IO.File]::ReadAllBytes($tmp)
      if ($bytes.Length -gt 500) {
        $headOk = $true
        for ($i = 0; $i -lt 8; $i++) { if ($bytes[$i] -ne $pngSig[$i]) { $headOk = $false; break } }
        if ($headOk) {
          Copy-Item $tmp $out -Force
          Write-Output ("OK    {0}  <-  {1}  ({2} bytes)" -f $name, $url, $bytes.Length)
          $ok = $true
          break
        }
      }
    } catch {
      Write-Output ("retry {0}  ({1}): {2}" -f $name, $url, $_.Exception.Message)
    }
  }
  if (-not $ok) {
    Write-Output ("FAIL  {0}" -f $name)
    $failed += $name
  }
}
Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Output "----"
Write-Output ("FAILED: {0}" -f ($failed -join ", "))
