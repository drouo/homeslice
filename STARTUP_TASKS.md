# Startup Tasks

All services start automatically at Windows logon via Task Scheduler.
Caddy provides `*.localhost` routing to all apps over HTTP on port 80.

## Quick reference

| Task name        | Status     | Run level | Ports served     | URL                           |
|------------------|------------|-----------|------------------|-------------------------------|
| Homeslice Caddy  | Registered | Highest   | 80               | *(all .localhost domains)*    |
| Homeslice Helper | Registered | Limited   | 3456             | internal — used by index.html |
| Goalspace        | Registered | Highest   | 4040 / 4174      | http://goalspace.localhost    |
| Serverspace      | Registered | Highest   | 4000 / 5002      | http://serverspace.localhost  |
| Affinatrix       | Registered | Limited   | 5001             | http://affinatrix.localhost   |

Run `install-startup-task.ps1` **as Administrator** to register or refresh all tasks.

---

## Task details

### Homeslice Caddy
- **Trigger:** at logon, no delay — runs as Administrator
- **Process:** `C:\Apps\caddy\caddy.exe run --config "C:\Apps\caddy\Caddyfile"`
- **Purpose:** Reverse proxy. Routes `*.localhost` traffic on port 80:
  - `homeslice.localhost` → static files from `C:\Apps\Homeslice` + open-dir helper
  - `goalspace.localhost` → API :4040, UI :4174
  - `serverspace.localhost` → API :4000, UI :5002
  - `affinatrix.localhost` → UI :5001
- **Logs:** `C:\Apps\caddy\logs\caddy.log` / `caddy.err.log`
- **Config:** `C:\Apps\caddy\Caddyfile`

### Homeslice Helper
- **Trigger:** at logon, no delay — runs as current user
- **Process:** `node.exe "C:\Apps\Homeslice\open-dir-server.mjs"`
- **Purpose:** Tiny HTTP server on :3456 that opens Windows Explorer to a path on request.
  Used by the Homeslice dashboard to navigate to project directories.

### Goalspace
- **Trigger:** at logon, 10 s delay — runs as Administrator (needed to clear ports)
- **Process:** `pwsh.exe -WindowStyle Hidden -File "C:\Apps\goalspace\serve.ps1" -SkipBuild`
- **Purpose:** Starts the Goalspace Node.js backend (:4040) and Vite preview frontend (:4174).
  `-SkipBuild` assumes `frontend/dist/` is already built; run `serve.ps1` once without it
  after pulling new code.
- **Logs:** `C:\Apps\goalspace\logs\`
- **Registration script:** `C:\Apps\goalspace\scripts\register-startup-task.ps1`

### Serverspace
- **Trigger:** at logon, 10 s delay — runs as Administrator (needed to clear ports)
- **Process:** `pwsh.exe -WindowStyle Hidden -File "C:\Apps\serverspace\scripts\serve.ps1" -SkipBuild -SkipInstall -NoBrowser -UiPort 5002`
- **Purpose:** Pulls latest code, runs Prisma migrations, starts Node.js backend (:4000)
  and Vite preview frontend (:5002).
- **Logs:** `C:\Apps\serverspace\logs\`

### Affinatrix
- **Trigger:** at logon, 10 s delay — runs as current user
- **Process:** `node.exe "C:\Apps\Affinatrix\node_modules\vite\bin\vite.js" preview`
- **Purpose:** Serves the Affinatrix React SPA as a static Vite preview on :5001.
  Port is set in `vite.config.js`. No backend.

---

## Re-registering or rebuilding tasks

Run from an **elevated** PowerShell terminal:

```powershell
& "C:\Apps\Homeslice\install-startup-task.ps1"
```

Or right-click `install-startup-task.bat` → **Run as administrator**.

To check current state:

```powershell
Get-ScheduledTask | Where-Object TaskName -match 'homeslice|goalspace|serverspace|affinatrix|caddy' |
  Select-Object TaskName, State | Sort-Object TaskName
```

To start a task immediately without rebooting:

```powershell
Start-ScheduledTask -TaskName 'Goalspace'
```
