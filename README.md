# Homeslice

A local development dashboard that auto-discovers your projects and gives you a hub for opening them in the browser, file explorer, terminal, or running quick commands.

## Architecture

```
Browser  ──►  Caddy (port 80)  ──►  Static files (index.html)
                  │
                  └──►  Helper server (port 3456)
                          ├── /projects     — JSON list of projects
                          ├── /open-dir     — open folder in Explorer
                          ├── /open-term    — open terminal at project root
                          └── /run          — execute a command in a project
```

- **Caddy** reverse-proxies `homeslice.localhost` to serve the dashboard and route API calls to the helper server.
- **Helper server** (`open-dir-server.mjs`) is a small Node.js process that scans directories for project manifests and handles actions.

## Prerequisites

- [Node.js](https://nodejs.org/) (18+)
- [Caddy](https://caddyserver.com/) — runs as a reverse proxy on port 80
- Windows (for Explorer/terminal integration; assumes `cmd.exe`)

## Quick start

1. **Clone this repo** to `C:\Apps\Homeslice` (or wherever you like):

   ```powershell
   git clone https://github.com/YOUR_USER/homeslice C:\Apps\Homeslice
   ```

2. **Configure scan roots** — copy the example config and edit:

   ```powershell
   copy C:\Apps\Homeslice\homeslice.config.example.json C:\Apps\Homeslice\homeslice.config.json
   notepad C:\Apps\Homeslice\homeslice.config.json
   ```

   Set `scanRoots` to the directories where you keep your projects:

   ```json
   {
     "scanRoots": ["C:\\Apps", "D:\\Projects"]
   }
   ```

3. **Install and start services**:

   ```powershell
   # Run as Administrator (needed for scheduled tasks and port 80)
   C:\Apps\Homeslice\install-startup-task.ps1
   ```

   This creates two scheduled tasks — `Homeslice Caddy` and `Homeslice Helper` — that start automatically.

4. **Add a project** — drop a `homeslice.json` file into any project directory:

   ```json
   {
     "name": "My App",
     "description": "A cool web app",
     "tech": "React + Vite",
     "section": "web",
     "url": "http://myapp.localhost",
     "port": 5173
   }
   ```

5. **Open the dashboard** at [http://homeslice.localhost](http://homeslice.localhost)

## Adding a project

Create a `homeslice.json` in the project's root directory. Fields:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Display name on the dashboard |
| `description` | no | Subtitle under the name |
| `tech` | no | Badge text (e.g. `Fastify + React`) |
| `section` | no | `web` / `desktop` / `docs` (defaults to `web`) |
| `url` | no | Shows an "Open" button linking here |
| `port` | no | Live status dot — pings `localhost:<port>` every 30s |

The project's GitHub URL is auto-detected from `.git/config` if present.

## Dashboard features

Each project card shows:

| Button | Action |
|--------|--------|
| **Open** | Opens the project's URL in a new tab |
| **Term** | Opens a terminal (Windows Terminal or PowerShell) at the project root |
| **Dir** | Opens the project folder in Windows Explorer |
| **Cmd** | Toggles a command panel — run presets or custom commands inline |
| **GitHub** | Opens the project's GitHub page |

The status dot (left of the project name) is green when the project's port is responding, red otherwise.

## Configuration

Edit `C:\Apps\Homeslice\homeslice.config.json`:

```json
{
  "scanRoots": ["C:\\Apps", "D:\\Projects"]
}
```

Changes take effect on the next dashboard refresh — no server restart needed. If the file is missing or malformed, it falls back to `["C:\\Apps"]`.

## Running without scheduled tasks

```powershell
# Start the helper server (terminal 1)
node C:\Apps\Homeslice\open-dir-server.mjs

# Start Caddy (terminal 2, as Administrator)
caddy run --config C:\Apps\caddy\Caddyfile
```

## Security notes

- The admin API is disabled in the Caddyfile (`admin off`).
- The config file (`homeslice.config.json`) is blocked from HTTP access by Caddy.
- The `/run` endpoint only executes commands in known project directories (validated against the loaded project list).
- Commands have a 30-second timeout and output is capped at 100 KB.
- Everything runs on localhost only (`.localhost` domains don't resolve externally).
