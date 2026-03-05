$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-ProcessMatch {
	param(
		[Parameter(Mandatory = $true)][string]$Pattern
	)

	$matches = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
		Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern }
	return @($matches).Count -gt 0
}

function Test-PortListening {
	param(
		[Parameter(Mandatory = $true)][int]$Port
	)

	$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
	return $null -ne $listener
}

$backendRunning = Test-ProcessMatch -Pattern "uvicorn\s+app\.main:app"
$frontendRunning = Test-ProcessMatch -Pattern "vite(\.cmd)?\s|npm(\.cmd)?\s+run\s+dev"

if (!$backendRunning -and (Test-PortListening -Port 8000)) {
	Write-Warning "Port 8000 is already in use by a non-backend process. Backend launch skipped to avoid duplicate/conflicting listeners."
} elseif ($backendRunning) {
	Write-Host "Backend already running. Skipping backend launch."
} else {
	Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $scriptRoot "start-backend.ps1")
}

Start-Sleep -Seconds 2

if ($frontendRunning) {
	Write-Host "Frontend already running. Skipping frontend launch."
} else {
	Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $scriptRoot "start-frontend.ps1")
}
