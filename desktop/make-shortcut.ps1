# Puts a "The Brain" shortcut with the app's icon on the desktop and in the Start menu.
# It opens the desktop app from this folder: npm.cmd run shortcut
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'build\icon.ico'
if (-not (Test-Path $electron)) { Write-Host 'Electron is not installed here yet. Run npm.cmd install first.'; exit 1 }
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'The Brain.lnk'))
  $lnk.TargetPath = $electron
  $lnk.Arguments = '"' + $root + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'The Brain: ORIGIN and the agents it grows'
  $lnk.Save()
  Write-Host "Shortcut added: $dir\The Brain.lnk"
}
