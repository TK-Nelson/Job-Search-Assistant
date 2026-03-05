$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$repoRuntimeRoot = Join-Path $repoRoot ".runtime"
$legacyRuntimeRoot = Join-Path $env:LOCALAPPDATA "JobSearchAssistant"

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

$env:JOB_SEARCH_ASSISTANT_RUNTIME_ROOT = $repoRuntimeRoot
Write-Host "Runtime root: $repoRuntimeRoot"

if (!(Test-Path $repoRuntimeRoot)) {
    New-Item -ItemType Directory -Force -Path $repoRuntimeRoot | Out-Null
}

$repoDb = Join-Path $repoRuntimeRoot "data\job_assistant.db"
$legacyDb = Join-Path $legacyRuntimeRoot "data\job_assistant.db"
if (!(Test-Path $repoDb) -and (Test-Path $legacyDb)) {
    Write-Host "Seeding repo-local runtime data from: $legacyRuntimeRoot"
    foreach ($name in @("config", "data", "logs")) {
        $src = Join-Path $legacyRuntimeRoot $name
        if (Test-Path $src) {
            $dst = Join-Path $repoRuntimeRoot $name
            New-Item -ItemType Directory -Force -Path $dst | Out-Null
            Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Set-Location $backendDir

# Load .env file if present (keeps secrets out of source code)
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
