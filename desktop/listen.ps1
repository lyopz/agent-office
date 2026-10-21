# Listens once on the default microphone with Windows' own offline speech recognition and prints
# what was said. The desktop app runs this when you press the mic button; nothing leaves the PC.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Speech
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $engine.SetInputToDefaultAudioDevice()
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(8)
  $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(4)
  $result = $engine.Recognize([TimeSpan]::FromSeconds(30))
  $engine.Dispose()
  if ($result -and $result.Text) { Write-Output ('OK ' + $result.Text) } else { Write-Output 'NONE' }
} catch {
  Write-Output ('ERR ' + $_.Exception.Message)
}
