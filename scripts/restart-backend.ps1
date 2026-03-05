$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$stopScript = Join-Path $repoRoot "scripts\stop-backend.ps1"
$startScript = Join-Path $repoRoot "scripts\start-backend.ps1"

Write-Host "Stopping backend..."
& $stopScript

# Brief pause to let the port release
Start-Sleep -Seconds 1

Write-Host ""
Write-Host "Starting backend..."
& $startScript
