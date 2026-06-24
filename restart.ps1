# Self-elevate to admin if needed — required to kill the helper process
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process pwsh -ArgumentList "-NonInteractive -File `"$PSCommandPath`"" -Verb RunAs -Wait
    exit
}

$taskName = 'Homeslice Helper'
$port     = 3456
$node     = 'C:\Program Files\nodejs\node.exe'
$script   = 'C:\Apps\Homeslice\open-dir-server.mjs'

# Kill whatever is listening on :3456
$pidOnPort = (netstat -ano | Select-String ":$port\s.*LISTENING" |
    ForEach-Object { ($_.ToString().Trim() -split '\s+')[-1] } |
    Select-Object -First 1)
if ($pidOnPort) {
    Write-Host "Killing PID $pidOnPort on port $port..." -ForegroundColor DarkGray
    taskkill /F /PID $pidOnPort 2>$null | Out-Null
    Start-Sleep -Milliseconds 600
}

# Stop via Task Scheduler too (best-effort)
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

# Try to start via scheduled task
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

# Wait up to 3 s for :3456 to come back
$up = $false
$deadline = (Get-Date).AddSeconds(3)
while (-not $up -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
    if (netstat -ano | Select-String ":$port\s.*LISTENING") { $up = $true }
}

# If the task didn't bring it up, launch the node process directly
if (-not $up) {
    Write-Host "Scheduled task not found — starting helper directly..." -ForegroundColor Yellow
    Start-Process $node -ArgumentList "`"$script`"" -WindowStyle Hidden
    Start-Sleep -Seconds 1
}

Write-Host "Homeslice Helper restarted on port $port." -ForegroundColor Green
