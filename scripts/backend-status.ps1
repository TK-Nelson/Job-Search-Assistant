$ErrorActionPreference = "SilentlyContinue"

Write-Host "=== Backend Status ==="
Write-Host ""

# Check for uvicorn process
$uvicornProcs = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine -match "uvicorn\s+app\.main:app" }

if (@($uvicornProcs).Count -gt 0) {
    Write-Host "  Process:  RUNNING" -ForegroundColor Green
    foreach ($proc in @($uvicornProcs)) {
        Write-Host "            PID $($proc.ProcessId)"
    }
} else {
    Write-Host "  Process:  NOT RUNNING" -ForegroundColor Red
}

# Check port 8000
$listener = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $listener) {
    Write-Host "  Port 8000: LISTENING (PID $($listener.OwningProcess))" -ForegroundColor Green
} else {
    Write-Host "  Port 8000: FREE" -ForegroundColor Yellow
}

# Health check
Write-Host ""
try {
    $response = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/health" -TimeoutSec 3
    Write-Host "  Health:   OK" -ForegroundColor Green
    if ($response.status) { Write-Host "            $($response.status)" }
} catch {
    Write-Host "  Health:   UNREACHABLE" -ForegroundColor Red
}

Write-Host ""
