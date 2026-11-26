# Applies a downloaded Hexhub update: closes the client, copies the new files, restarts it.
# Started by core/updater.js from a temp copy. User data (%APPDATA%\Hexhub, %APPDATA%\Hexcall) is never touched.
param([Parameter(Mandatory)] [string]$Source, [Parameter(Mandatory)] [string]$Target)
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'Hexhub-update.log'
"$(Get-Date -Format s) Update from '$Source' to '$Target'" | Out-File $log -Encoding utf8

Start-Sleep -Seconds 2
$profileDir = Join-Path $env:LOCALAPPDATA 'Hexhub\edge'
# 1) stop the watchdog, the client window and the backend
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $Target 'core\start.ps1')) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$conn = Get-NetTCPConnection -LocalPort 47810 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# 2) copy the new files (keep user data in portable installs)
robocopy $Source $Target /E /R:3 /W:1 /XD data /XF portable.txt /NFL /NDL /NJH /NJS | Out-File $log -Append -Encoding utf8
"$(Get-Date -Format s) robocopy exit $LASTEXITCODE" | Out-File $log -Append -Encoding utf8

# 3) restart
Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$(Join-Path $Target 'Hexhub.vbs')`"" -WorkingDirectory $Target
