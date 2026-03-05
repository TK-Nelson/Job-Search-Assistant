$ErrorActionPreference = "Stop"

# Kill uvicorn processes by command line match
$uvicornProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match "uvicorn\s+app\.main:app" }

$killed = 0
foreach ($proc in @($uvicornProcs)) {
    try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Write-Host "Stopped uvicorn PID $($proc.ProcessId)"
        $killed++
    } catch {
        Write-Warning "Could not stop PID $($proc.ProcessId): $_"
    }
}

# Also kill any process listening on port 8000 (catches orphaned children)
$listeners = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue
foreach ($conn in @($listeners)) {
    if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
        try {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
            Write-Host "Stopped port-8000 listener PID $($conn.OwningProcess)"
            $killed++
        } catch {
            Write-Warning "Could not stop PID $($conn.OwningProcess): $_"
        }
    }
}

if ($killed -eq 0) {
    Write-Host "No backend processes found."
} else {
    Write-Host "Backend stopped ($killed process(es) terminated)."
}
