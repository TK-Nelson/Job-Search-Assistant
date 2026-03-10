$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
# Runtime root is now driven by JSA_RUNTIME_ROOT in backend/.env and loaded
# by python-dotenv inside config.py — no shell-level injection needed.

$existingBackend = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match "uvicorn\s+app\.main:app" }

if (@($existingBackend).Count -gt 0) {
    Write-Host "Backend already running. Skipping startup."
    exit 0
}

$portListener = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $portListener) {
    Write-Error "Port 8000 is already in use. Resolve the listener conflict before starting backend."
    exit 1
}

Set-Location $backendDir

# Load .env file so non-Python tools (pip, etc.) also see the variables.
$envFile = Join-Path $backendDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
    Write-Host "Loaded environment from .env"
}

# Resolve runtime root the same way Python does
$runtimeRoot = $env:JSA_RUNTIME_ROOT
if (-not $runtimeRoot) { $runtimeRoot = $env:JOB_SEARCH_ASSISTANT_RUNTIME_ROOT }
if ($runtimeRoot) {
    # Resolve relative paths against backend/
    if (-not [System.IO.Path]::IsPathRooted($runtimeRoot)) {
        $runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $backendDir $runtimeRoot))
    }
} else {
    $runtimeRoot = Join-Path $env:LOCALAPPDATA "JobSearchAssistant"
}
Write-Host "Runtime root: $runtimeRoot"

if (!(Test-Path $runtimeRoot)) {
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
}

if (!(Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}

& ".venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".venv\Scripts\python.exe" -m app.db.migrate
$reloadEnabled = ($env:JSA_BACKEND_RELOAD -eq "1")
if ($reloadEnabled) {
    & ".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --port 8000
} else {
    & ".venv\Scripts\python.exe" -m uvicorn app.main:app --port 8000
}
