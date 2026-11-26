# Starts the Hexhub client window and keeps its backend alive while the window is open.
# The backend is restarted automatically if it ever stops, and shut down once the window is closed.
$Port = 47810
$Url = "http://127.0.0.1:$Port/"
$App = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $PSScriptRoot 'server.js'
$EdgeProfile = Join-Path $env:LOCALAPPDATA 'Hexhub\edge'

# Bundled Node.js (release builds) or the installed one (development)
$Node = Join-Path $App 'runtime\node.exe'
if (-not (Test-Path $Node)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $Node = $cmd.Source } else {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show("Node.js was not found.`r`nPlease use the release version of Hexhub (it contains everything needed).", 'Hexhub', 'OK', 'Error') | Out-Null
        return
    }
}

function Test-Port {
    try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $Port); $c.Close(); return $true } catch { return $false }
}
function Start-Backend {
    Start-Process -FilePath $Node -ArgumentList "`"$Server`"" -WindowStyle Hidden
    for ($i = 0; $i -lt 50 -and -not (Test-Port); $i++) { Start-Sleep -Milliseconds 100 }
}
function Get-ClientWindows {
    # Edge processes that belong to our own profile = the client window is open
    Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($EdgeProfile) }
}

if (-not (Test-Port)) { Start-Backend }

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Start-Process $Url; return }

# Another watchdog already running for an open window? Then just bring up a window and leave.
$alreadyOpen = @(Get-ClientWindows).Count -gt 0
Start-Process -FilePath $edge -ArgumentList "--app=$Url", "--user-data-dir=`"$EdgeProfile`"", '--window-size=1440,900', '--no-first-run', '--no-default-browser-check'
if ($alreadyOpen) { return }

Start-Sleep -Seconds 3
while (@(Get-ClientWindows).Count -gt 0) {
    if (-not (Test-Port)) { Start-Backend }
    Start-Sleep -Seconds 3
}

# Window closed: stop the backend
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
