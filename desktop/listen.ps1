# Listens once on the default microphone with Windows' own offline speech recognition and prints
# what was said. The desktop app runs this when you press the mic button; nothing leaves the PC.
# Output is one line: OK <text>, NONE (nothing heard) or ERR <reason>.
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
  $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(4)
  $result = $engine.Recognize([TimeSpan]::FromSeconds(30))
  $engine.Dispose()
  if ($result -and $result.Text) { Write-Output ('OK ' + $result.Text) } else { Write-Output 'NONE' }
} catch {
  Write-Output ('ERR ' + ($_.Exception.Message -replace '\s+', ' '))
}
