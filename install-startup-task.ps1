# Run this script as Administrator to register all Homeslice startup tasks.
# Right-click -> "Run with PowerShell" (as Admin), or from an elevated terminal:
#   & "C:\Apps\Homeslice\install-startup-task.ps1"

$node  = "C:\Program Files\nodejs\node.exe"
$pwsh  = (Get-Command pwsh -ErrorAction Stop).Source
$user  = $env:USERNAME

$triggerImmediate = New-ScheduledTaskTrigger -AtLogOn -User $user

$triggerDelayed = New-ScheduledTaskTrigger -AtLogOn -User $user
$triggerDelayed.Delay = 'PT10S'

$settingsLimited  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$settingsElevated = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

function Register ($name, $action, $trigger, $settings, $runLevel, $desc) {
    $params = @{
        TaskName    = $name
        Action      = $action
        Trigger     = $trigger
        Settings    = $settings
        Description = $desc
        Force       = $true
    }
    if ($runLevel -eq 'Highest') { $params.RunLevel = 'Highest' }
    Register-ScheduledTask @params | Out-Null
    if ($?) { Write-Host "  [OK] $name" -ForegroundColor Green }
    else     { Write-Host "  [FAIL] $name" -ForegroundColor Red }
}

Write-Host ""
Write-Host "Registering Homeslice startup tasks for user: $user" -ForegroundColor Cyan
Write-Host ""

# ── Homeslice Helper (open-dir server :3456, no elevation needed) ──────────────
Register "Homeslice Helper" `
    (New-ScheduledTaskAction -Execute $node -Argument "`"C:\Apps\Homeslice\open-dir-server.mjs`"") `
    $triggerImmediate $settingsLimited 'Limited' `
    "Homeslice open-dir helper server on port 3456"

# ── Homeslice Caddy (reverse proxy :80, needs elevation) ──────────────────────
Register "Homeslice Caddy" `
    (New-ScheduledTaskAction -Execute "C:\Apps\caddy\caddy.exe" -Argument "run --config `"C:\Apps\caddy\Caddyfile`"") `
    $triggerImmediate $settingsElevated 'Highest' `
    "Caddy reverse proxy for all *.localhost apps on port 80"

# ── Goalspace (backend :4040, frontend :4174, needs elevation to clear ports) ──
Register "Goalspace" `
    (New-ScheduledTaskAction -Execute $pwsh `
        -Argument "-WindowStyle Hidden -NonInteractive -File `"C:\Apps\goalspace\serve.ps1`" -SkipBuild" `
        -WorkingDirectory "C:\Apps\goalspace") `
    $triggerDelayed $settingsElevated 'Highest' `
    "Goalspace backend :4040 and frontend :4174"

# ── Serverspace (backend :4000, frontend :5002, needs elevation to clear ports)
Register "Serverspace" `
    (New-ScheduledTaskAction -Execute $pwsh `
        -Argument "-WindowStyle Hidden -NonInteractive -File `"C:\Apps\serverspace\scripts\serve.ps1`" -SkipBuild -SkipInstall -NoBrowser -UiPort 5002" `
        -WorkingDirectory "C:\Apps\serverspace") `
    $triggerDelayed $settingsElevated 'Highest' `
    "Serverspace backend :4000 and frontend :5002"

# ── Affinatrix (frontend-only Vite preview :5001, no elevation needed) ─────────
Register "Affinatrix" `
    (New-ScheduledTaskAction -Execute $node `
        -Argument "`"C:\Apps\Affinatrix\node_modules\vite\bin\vite.js`" preview" `
        -WorkingDirectory "C:\Apps\Affinatrix") `
    $triggerDelayed $settingsLimited 'Limited' `
    "Affinatrix Vite preview frontend :5001"

Write-Host ""
Write-Host "All tasks registered. They will run at the next logon." -ForegroundColor Cyan
Write-Host "To start them now without rebooting:" -ForegroundColor DarkGray
Write-Host "  'Homeslice Caddy','Homeslice Helper','Goalspace','Serverspace','Affinatrix' | ForEach-Object { Start-ScheduledTask `$_ }" -ForegroundColor DarkGray
Write-Host ""
