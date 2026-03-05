$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend"

$existingFrontend = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
	Where-Object { $_.CommandLine -and $_.CommandLine -match "vite(\.cmd)?\s|npm(\.cmd)?\s+run\s+dev" }

if (@($existingFrontend).Count -gt 0) {
	Write-Host "Frontend already running. Skipping startup."
	exit 0
}

$vitePortInUse = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $vitePortInUse) {
	Write-Warning "Port 5173 is already listening. Frontend launch skipped to avoid duplicate dev servers."
	exit 0
}

Set-Location $frontendDir
npm install
npm run dev
