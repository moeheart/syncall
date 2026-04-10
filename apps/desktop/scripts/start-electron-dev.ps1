$ErrorActionPreference = "Stop"

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:SYNCALL_DESKTOP_DEV_URL = "http://127.0.0.1:5173"

for ($i = 0; $i -lt $args.Count; $i++) {
  $current = [string]$args[$i]

  if ($current.StartsWith("--profile=")) {
    $env:SYNCALL_PROFILE = $current.Substring("--profile=".Length)
    break
  }

  if ($current -eq "--profile" -and $i + 1 -lt $args.Count) {
    $env:SYNCALL_PROFILE = [string]$args[$i + 1]
    break
  }
}

npx electron . @args
exit $LASTEXITCODE
