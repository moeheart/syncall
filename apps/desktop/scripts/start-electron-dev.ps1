$ErrorActionPreference = "Stop"

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:SYNCALL_DESKTOP_DEV_URL = "http://127.0.0.1:5173"

npx electron . @args
exit $LASTEXITCODE
