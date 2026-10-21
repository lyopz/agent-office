# Listens on the default microphone with Windows' own offline speech recognition and prints what
# was said. The desktop app runs this when you press Speak (or say Hey JARVIS); nothing leaves the PC.
# It keeps listening through pauses shorter than -Pause seconds, so a breath doesn't cut you off,
# and stops after a longer silence (or when the app stops it, which keeps what was heard so far).
# Output: "PART <text>" for each phrase as it is heard, then one line "OK <all text>", "NONE"
# (nothing heard) or "ERR <reason>".
param([double]$Pause = 2.5, [double]$MaxSeconds = 90)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $installed -or $installed.Count -eq 0) { Write-Output 'ERR NORECOGNIZER'; exit 0 }
  # prefer the recognizer for Windows' own language, else any installed one (usually English)
  $pick = $installed | Where-Object { $_.Culture.Name -eq [System.Globalization.CultureInfo]::CurrentUICulture.Name } | Select-Object -First 1
  if (-not $pick) { $pick = $installed | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1 }
  if (-not $pick) { $pick = $installed[0] }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($pick)
  try { $engine.SetInputToDefaultAudioDevice() } catch { Write-Output 'ERR NOMIC'; exit 0 }
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(8)
  $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.8)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(6)
  $parts = New-Object System.Collections.Generic.List[string]
  $started = Get-Date
  while ($true) {
    $left = $MaxSeconds - ((Get-Date) - $started).TotalSeconds
    if ($left -le 0) { break }
    # the first phrase may take a while to start; after that, a silence of $Pause seconds ends it
    $wait = if ($parts.Count -eq 0) { [Math]::Min(12, $left) } else { [Math]::Min($Pause, $left) }
    $result = $engine.Recognize([TimeSpan]::FromSeconds($wait))
    if ($result -and $result.Text) {
      $parts.Add($result.Text)
      Write-Output ('PART ' + $result.Text)
    } else {
      break
    }
  }
  $engine.Dispose()
  if ($parts.Count -gt 0) { Write-Output ('OK ' + ($parts -join ' ')) } else { Write-Output 'NONE' }
} catch {
  Write-Output ('ERR ' + ($_.Exception.Message -replace '\s+', ' '))
}
