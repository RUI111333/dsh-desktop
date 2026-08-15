# Create a desktop shortcut "DeepSeek Harness.lnk" pointing to the packaged app,
# using the black whale icon embedded in the exe.
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot 'dist\win-unpacked\DeepSeek Harness.exe'

$shortcutPath = Join-Path $desktop 'DeepSeek Harness.lnk'
$lnk = $ws.CreateShortcut($shortcutPath)
$lnk.TargetPath = $target
$lnk.WorkingDirectory = Split-Path $target
$lnk.IconLocation = "$target,0"
$lnk.Description = 'DeepSeek Harness'
$lnk.Save()

Write-Output "shortcut created: $shortcutPath"
