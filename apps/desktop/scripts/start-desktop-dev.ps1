$ErrorActionPreference = "Stop"

function Test-PortOpen {
  param(
    [string]$TargetHost,
    [int]$Port
  )

  $client = $null

  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect($TargetHost, $Port, $null, $null)

    if (-not $async.AsyncWaitHandle.WaitOne(1500, $false)) {
      return $false
    }

    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    if ($client) {
      $client.Dispose()
    }
  }
}

$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopHost = "127.0.0.1"
$port = 5173

if (Test-PortOpen -TargetHost $desktopHost -Port $port) {
  Write-Host "Reusing existing desktop dev server on port $port."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-electron-dev.ps1") @args
  exit $LASTEXITCODE
}

$vite = Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run", "dev:host" `
  -WorkingDirectory $desktopRoot `
  -PassThru

try {
  npx wait-on "tcp:$port"
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop dev server did not start on port $port."
  }

  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-electron-dev.ps1") @args
  exit $LASTEXITCODE
} finally {
  if ($vite -and -not $vite.HasExited) {
    Stop-Process -Id $vite.Id -Force
  }
}
