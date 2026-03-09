$root = "C:\Users\Silva\WORKSPACE\accsolisbuss"
$port = 3000
$hostName = "127.0.0.1"
$serverUrl = "http://${hostName}:$port"

$existingListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

function Test-ServerReady {
  param([string]$Url)
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $res.StatusCode -ge 200 -and $res.StatusCode -lt 500
  } catch {
    return $false
  }
}

if ($existingListener -and -not (Test-ServerReady -Url $serverUrl)) {
  try {
    Stop-Process -Id $existingListener.OwningProcess -Force -ErrorAction Stop
    Start-Sleep -Seconds 1
  } catch {
    Write-Host "Port $port is occupied by an unresponsive process and could not be stopped automatically."
    exit 1
  }
  $existingListener = $null
}

if (-not $existingListener) {
  # Start the dev server in a new PowerShell window (kept open for logs)
  Start-Process -FilePath "pwsh" -ArgumentList "-NoExit", "-Command", "cd `"$root`"; bun run dev -- --hostname $hostName --port $port" -WindowStyle Minimized
} else {
  try {
    $proc = Get-Process -Id $existingListener.OwningProcess -ErrorAction Stop
    Write-Host "Port $port already in use by PID $($proc.Id) ($($proc.ProcessName)); reusing existing server."
  } catch {
    Write-Host "Port $port is already in use; reusing existing server."
  }
}

# Wait until HTTP responds before opening Edge app mode.
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  if (Test-ServerReady -Url $serverUrl) {
    $ready = $true
    break
  }
  Start-Sleep -Milliseconds 500
}

if (-not $ready) {
  Write-Host "Server did not become reachable at $serverUrl. Check the dev server window for startup errors."
  exit 1
}

# Open as a standalone app window with a roomier default size.
Start-Process "msedge.exe" "--disable-extensions --app=$serverUrl --window-size=1280,860"
