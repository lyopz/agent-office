# Listens for "Hey JARVIS" on the default microphone with Windows' own offline speech recognition,
# and prints WAKE each time it hears it. Only that phrase is listened for; nothing is recorded or
# sent anywhere. The desktop app runs this while Hey JARVIS is on, and stops it when it's off.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if (-not $installed -or $installed.Count -eq 0) { Write-Output 'ERR NORECOGNIZER'; exit 0 }
  $pick = $installed | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
  if (-not $pick) { $pick = $installed[0] }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($pick)
  try { $engine.SetInputToDefaultAudioDevice() } catch { Write-Output 'ERR NOMIC'; exit 0 }
  $choices = New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]@('hey jarvis', 'hi jarvis', 'okay jarvis', 'jarvis'))
  $builder = New-Object System.Speech.Recognition.GrammarBuilder
  $builder.Culture = $pick.Culture
  $builder.Append($choices)
  $engine.LoadGrammar((New-Object System.Speech.Recognition.Grammar($builder)))
  # a catch-all for everything else, so ordinary talk isn't forced onto "jarvis"
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  Write-Output 'READY'
  while ($true) {
    $r = $engine.Recognize([TimeSpan]::FromSeconds(30))
    if ($r -and $r.Grammar -and -not ($r.Grammar -is [System.Speech.Recognition.DictationGrammar]) -and $r.Confidence -ge 0.6) { Write-Output 'WAKE' }
  }
} catch {
  Write-Output ('ERR ' + ($_.Exception.Message -replace '\s+', ' '))
}
