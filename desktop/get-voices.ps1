# Downloads JARVIS's free offline voices: Kokoro (28 natural voices, the default) and Piper (simpler
# ones). Both live under %LOCALAPPDATA%\the-brain, outside the app folder. Run it with: npm.cmd run get-voices
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Kokoro runs with Node and needs its package plus a one-time model download (about 330 MB).
Write-Host 'Installing the Kokoro voice package...'
& npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host 'npm install failed; fix that and run this again.'; exit 1 }
& node server/kokoro-say.mjs --warm
if ($LASTEXITCODE -ne 0) { Write-Host 'The Kokoro download did not finish. Run this again when you are online.' }
Write-Host ''
Write-Host 'Getting the Piper voices too (simpler, as a spare)...'
$root = Join-Path $env:LOCALAPPDATA 'the-brain\piper'
$voices = Join-Path $root 'voices'
New-Item -ItemType Directory -Force -Path $voices | Out-Null

if (-not (Test-Path (Join-Path $root 'piper\piper.exe'))) {
  Write-Host 'Downloading Piper...'
  $zip = Join-Path $env:TEMP 'piper_windows_amd64.zip'
  Invoke-WebRequest 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' -OutFile $zip
  Expand-Archive $zip -DestinationPath $root -Force
  Remove-Item $zip
}

$base = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en'
$list = @(
  'en_GB/alan/medium/en_GB-alan-medium',
  'en_GB/northern_english_male/medium/en_GB-northern_english_male-medium',
  'en_US/ryan/high/en_US-ryan-high',
  'en_US/lessac/medium/en_US-lessac-medium'
)
foreach ($v in $list) {
  $name = Split-Path $v -Leaf
  foreach ($ext in '.onnx', '.onnx.json') {
    $out = Join-Path $voices ($name + $ext)
    if (Test-Path $out) { continue }
    Write-Host "Downloading voice $name$ext..."
    try { Invoke-WebRequest "$base/$v$ext" -OutFile "$out.part"; Move-Item "$out.part" $out -Force }
    catch { Write-Host "  Couldn't get $name ($($_.Exception.Message))"; Remove-Item "$out.part" -ErrorAction SilentlyContinue }
  }
}
Write-Host ''
Write-Host "Done. Voices are in $voices"
Write-Host 'Open Settings in The Brain and pick a voice under JARVIS voice. Michael (Kokoro) is the default.'
