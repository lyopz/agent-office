# Downloads Piper, a free offline voice engine, and a few natural-sounding voices for JARVIS.
# They go in %LOCALAPPDATA%\the-brain\piper, outside the app folder. Run it with: npm.cmd run get-voices
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
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
Write-Host 'Open Settings in The Brain and pick a voice under JARVIS voice.'
