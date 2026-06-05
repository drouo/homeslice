# Homeslice Dynamic Projects + Status Dots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded project cards in `index.html` with JS-rendered cards fed by a `/projects` API that scans `C:\Apps\*\homeslice.json`, and add live green/red status dots to each card that has a `port`.

**Architecture:** The existing `open-dir-server.mjs` helper (Node.js, port 3456) gains a `GET /projects` endpoint that scans `C:\Apps\*\homeslice.json` and auto-reads GitHub from each project's `.git\config`. Caddy routes `/projects` to the helper alongside the existing `/open-dir*` path. `index.html` fetches `/projects` on load, renders all cards grouped by section, and polls per-port status checks every 30 seconds.

**Tech Stack:** Node.js (no new deps), Caddy reverse proxy, vanilla JS/HTML

---

## File map

| Action | Path |
|--------|------|
| Modify | `C:\Apps\Homeslice\open-dir-server.mjs` |
| Modify | `C:\Apps\caddy\Caddyfile` |
| Modify | `C:\Apps\Homeslice\index.html` |
| Create | `C:\Apps\Affinatrix\homeslice.json` |
| Create | `C:\Apps\goalspace\homeslice.json` |
| Create | `C:\Apps\serverspace\homeslice.json` |
| Create | `C:\Apps\TerminalFantasy\homeslice.json` |
| Create | `C:\Apps\Latin\homeslice.json` |
| Create | `C:\Apps\LetsBuildit\homeslice.json` |
| Create | `C:\Apps\locallly\homeslice.json` |

> **Note — slimRDM:** Lives at `C:\Users\KingKarl\slimRDM`, outside `C:\Apps`. After Task 1 completes, add `'C:\\Users\\KingKarl\\slimRDM'` to the `SCAN_ROOTS` array in `open-dir-server.mjs` and drop a `homeslice.json` there to include it.

---

## Task 1: Add /projects endpoint to helper server

**Files:**
- Modify: `C:\Apps\Homeslice\open-dir-server.mjs`

- [ ] **Step 1: Replace open-dir-server.mjs with the following**

```javascript
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 3456;
const SCAN_ROOTS = ['C:\\Apps'];
const SECTION_ORDER = { web: 0, desktop: 1, docs: 2 };

function readGithubUrl(projectDir) {
  const gitConfig = join(projectDir, '.git', 'config');
  if (!existsSync(gitConfig)) return null;
  try {
    const text = readFileSync(gitConfig, 'utf8');
    const match = text.match(/\[remote "origin"\][^\[]*?url\s*=\s*(.+)/s);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function loadProjects() {
  const projects = [];
  for (const root of SCAN_ROOTS) {
    let entries;
    try { entries = readdirSync(root, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = join(root, entry.name);
      const manifestPath = join(projectDir, 'homeslice.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (!manifest.name) continue;
        projects.push({
          name:        manifest.name,
          description: manifest.description ?? null,
          tech:        manifest.tech ?? null,
          section:     manifest.section ?? 'web',
          url:         manifest.url ?? null,
          port:        manifest.port ?? null,
          dir:         projectDir,
          github:      manifest.github ?? readGithubUrl(projectDir),
        });
      } catch {
        // skip malformed manifests
      }
    }
  }
  projects.sort((a, b) => {
    const sa = SECTION_ORDER[a.section] ?? 99;
    const sb = SECTION_ORDER[b.section] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
  return projects;
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/open-dir') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    const dir = url.searchParams.get('path');
    if (dir) {
      spawn('cmd.exe', ['/c', 'start', '', 'explorer', dir], { detached: true, stdio: 'ignore' });
    }
    res.end('OK');

  } else if (url.pathname === '/projects') {
    const projects = loadProjects();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(projects));

  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`open-dir server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Restart the helper server**

```powershell
# Kill whatever is on port 3456
$conn = Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }
Start-ScheduledTask 'Homeslice Helper'
Start-Sleep -Seconds 2
```

- [ ] **Step 3: Verify the endpoint returns valid JSON**

```powershell
Invoke-RestMethod http://localhost:3456/projects
```

Expected: an empty JSON array `[]` (no manifests exist yet — that's fine).

---

## Task 2: Update Caddyfile to route /projects to the helper

**Files:**
- Modify: `C:\Apps\caddy\Caddyfile`

- [ ] **Step 1: Replace Caddyfile with the following**

```
{
	auto_https off
	admin off
}

http://goalspace.localhost {
	reverse_proxy /api/* localhost:4040
	reverse_proxy localhost:4174
}

http://serverspace.localhost {
	reverse_proxy /api/* localhost:4000
	reverse_proxy localhost:5002
}

http://affinatrix.localhost {
	reverse_proxy localhost:5001
}

http://homeslice.localhost {
	@helper {
		path /open-dir*
		path /projects
	}
	reverse_proxy @helper localhost:3456

	root * C:\Apps\Homeslice
	file_server
}
```

- [ ] **Step 2: Restart Caddy**

```powershell
$conn = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force }
Start-ScheduledTask 'Homeslice Caddy'
Start-Sleep -Seconds 2
```

- [ ] **Step 3: Verify /projects is reachable through Caddy**

```powershell
Invoke-RestMethod http://homeslice.localhost/projects
```

Expected: empty array `[]`.

---

## Task 3: Rewrite index.html with dynamic rendering and status dots

**Files:**
- Modify: `C:\Apps\Homeslice\index.html`

- [ ] **Step 1: Replace index.html with the following**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Homeslice</title>
<style>
  :root {
    --bg: #111;
    --surface: #1a1a2e;
    --card: #16213e;
    --accent: #0f3460;
    --text: #e0e0e0;
    --muted: #888;
    --green: #53d769;
    --blue: #4fc3f7;
    --gh: #333;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    padding: 2rem;
  }
  .container { max-width: 900px; margin: 0 auto; }
  header { margin-bottom: 2.5rem; }
  header h1 {
    font-size: 2.5rem;
    font-weight: 700;
    background: linear-gradient(135deg, var(--green), var(--blue));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  header p { color: var(--muted); margin-top: 0.25rem; font-size: 1rem; }
  .section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    margin-bottom: 0.75rem;
    margin-top: 1.5rem;
  }
  .project {
    background: var(--card);
    border: 1px solid #222;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    transition: border-color 0.2s;
  }
  .project:hover { border-color: var(--accent); }
  .project .info { flex: 1; min-width: 0; }
  .project .name {
    font-size: 1rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .project .name .badge {
    font-size: 0.65rem;
    font-weight: 500;
    padding: 0.15em 0.5em;
    border-radius: 4px;
    background: var(--accent);
    color: var(--blue);
  }
  .project .desc {
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 0.15rem;
  }
  .project .links {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .project .links a {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .link-open {
    background: var(--green);
    color: #000;
  }
  .link-open:hover { filter: brightness(1.1); }
  .link-dir {
    background: #222;
    color: var(--text);
    cursor: pointer;
    border: none;
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    transition: all 0.15s;
  }
  .link-dir:hover { background: #333; }
  .link-gh {
    background: var(--gh);
    color: var(--text);
  }
  .link-gh:hover { background: #444; }
  footer {
    margin-top: 3rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-green { background: var(--green); }
  .dot-red   { background: #e74c3c; }
  @media (max-width: 600px) {
    body { padding: 1rem; }
    .project { flex-direction: column; align-items: flex-start; }
    .project .links { width: 100%; flex-wrap: wrap; }
    .project .links a, .project .links button { flex: 1; justify-content: center; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Homeslice</h1>
    <p>Local development projects</p>
  </header>

  <div id="projects"><div class="section-title">Loading…</div></div>

  <footer>
    <span id="caddy-status"><span class="dot dot-red"></span> Caddy not running</span>
    <span style="margin:0 0.5rem">|</span>
    <span id="helper-status"><span class="dot dot-red"></span> Helper not running</span>
  </footer>
</div>

<script>
const SECTION_LABELS = {
  web:     'Web Apps (behind Caddy)',
  desktop: 'Desktop Apps',
  docs:    'Docs & Planning',
};

function slug(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
}

function openDir(path) {
  new Image().src = '/open-dir?path=' + encodeURIComponent(path);
}

function renderCard(p) {
  const dotHtml  = p.port
    ? `<span class="dot dot-red" id="status-${slug(p.name)}"></span>`
    : '';
  const badgeHtml = p.tech
    ? `<span class="badge">${p.tech}</span>`
    : '';
  const descHtml  = p.description
    ? `<div class="desc">${p.description}</div>`
    : '';
  const openHtml  = p.url
    ? `<a href="${p.url}" class="link-open" target="_blank">Open</a>`
    : '';
  const escapedDir = p.dir.replace(/\\/g, '\\\\');
  const dirHtml   = `<button class="link-dir" onclick="openDir('${escapedDir}')">Dir</button>`;
  const ghHtml    = p.github
    ? `<a href="${p.github}" class="link-gh" target="_blank">GitHub</a>`
    : '';
  return `
    <div class="project">
      <div class="info">
        <div class="name">${dotHtml}${p.name}${badgeHtml ? ' ' + badgeHtml : ''}</div>
        ${descHtml}
      </div>
      <div class="links">${openHtml}${dirHtml}${ghHtml}</div>
    </div>`;
}

function renderProjects(projects) {
  const container = document.getElementById('projects');
  const sections = {};
  for (const p of projects) {
    const s = p.section || 'web';
    (sections[s] = sections[s] || []).push(p);
  }
  const order = ['web', 'desktop', 'docs'];
  let html = '';
  for (const key of order) {
    if (!sections[key]?.length) continue;
    html += `<div class="section-title">${SECTION_LABELS[key] || key}</div>`;
    html += sections[key].map(renderCard).join('');
  }
  container.innerHTML = html || '<div class="section-title">No projects found</div>';
}

function checkServices(projects) {
  for (const p of projects) {
    if (!p.port) continue;
    const dot = document.getElementById(`status-${slug(p.name)}`);
    if (!dot) continue;
    fetch(`http://localhost:${p.port}`, { mode: 'no-cors' })
      .then(() => { dot.className = 'dot dot-green'; })
      .catch(() => { dot.className = 'dot dot-red'; });
  }
}

let _projects = [];

async function init() {
  const container = document.getElementById('projects');
  try {
    const res = await fetch('/projects');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _projects = await res.json();
    renderProjects(_projects);
    checkServices(_projects);
    setInterval(() => checkServices(_projects), 30000);
  } catch (err) {
    container.innerHTML = `
      <div class="project">
        <div class="info">
          <div class="name">Could not load projects</div>
          <div class="desc">${err.message} — is the helper server running?</div>
        </div>
        <div class="links"><button class="link-dir" onclick="init()">Retry</button></div>
      </div>`;
  }
}

function checkStatus() {
  const c = document.getElementById('caddy-status');
  const h = document.getElementById('helper-status');
  fetch('http://localhost:2019/config/')
    .then(r => r.ok
      ? (c.innerHTML = '<span class="dot dot-green"></span> Caddy running')
      : Promise.reject())
    .catch(() => { c.innerHTML = '<span class="dot dot-red"></span> Caddy not running'; });
  fetch('/open-dir?check=1')
    .then(r => r.ok
      ? (h.innerHTML = '<span class="dot dot-green"></span> Helper running')
      : Promise.reject())
    .catch(() => { h.innerHTML = '<span class="dot dot-red"></span> Helper not running'; });
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  checkStatus();
});
</script>
</body>
</html>
```

- [ ] **Step 2: Open http://homeslice.localhost in a browser**

Expected: page loads, shows "No projects found" under an empty section (manifests don't exist yet). No JS errors in DevTools console.

---

## Task 4: Create homeslice.json manifests for existing projects

**Files:** Seven new files, one per project.

- [ ] **Step 1: Create `C:\Apps\Affinatrix\homeslice.json`**

```json
{
  "name": "Affinatrix",
  "description": "Single-page React app",
  "tech": "Vite + React",
  "section": "web",
  "url": "http://affinatrix.localhost",
  "port": 5001
}
```

- [ ] **Step 2: Create `C:\Apps\goalspace\homeslice.json`**

```json
{
  "name": "goalspace",
  "description": "Full-stack goals & productivity app",
  "tech": "Fastify + React",
  "section": "web",
  "url": "http://goalspace.localhost",
  "port": 4040
}
```

- [ ] **Step 3: Create `C:\Apps\serverspace\homeslice.json`**

```json
{
  "name": "serverspace",
  "description": "Server reporting & monitoring platform",
  "tech": "Fastify + React",
  "section": "web",
  "url": "http://serverspace.localhost",
  "port": 4000
}
```

- [ ] **Step 4: Create `C:\Apps\TerminalFantasy\homeslice.json`**

```json
{
  "name": "TerminalFantasy",
  "description": "Terminal-based roguelike game",
  "tech": "Rust",
  "section": "desktop"
}
```

- [ ] **Step 5: Create `C:\Apps\Latin\homeslice.json`**

```json
{
  "name": "Latin",
  "description": "Latin language study notes",
  "section": "docs"
}
```

- [ ] **Step 6: Create `C:\Apps\LetsBuildit\homeslice.json`**

```json
{
  "name": "LetsBuildit",
  "description": "Project planning docs",
  "section": "docs"
}
```

- [ ] **Step 7: Create `C:\Apps\locallly\homeslice.json`**

```json
{
  "name": "locallly",
  "description": "Planning docs",
  "section": "docs"
}
```

- [ ] **Step 8: Verify the helper now returns all seven projects**

```powershell
Invoke-RestMethod http://localhost:3456/projects | Select-Object name, section, port
```

Expected output (order: web → desktop → docs, alpha within each):

```
name          section port
----          ------- ----
Affinatrix    web     5001
goalspace     web     4040
serverspace   web     4000
TerminalFantasy desktop
Latin         docs
LetsBuildit   docs
locallly      docs
```

---

## Task 5: End-to-end verification

- [ ] **Step 1: Open http://homeslice.localhost — confirm all seven cards render**

Check:
- Web Apps section shows Affinatrix, goalspace, serverspace — each with a red or green dot to the left of the name, an Open button, a Dir button, and a GitHub button (if the repo has a remote origin)
- Desktop Apps section shows TerminalFantasy with a Dir button and GitHub button (no dot, no Open)
- Docs & Planning section shows Latin, LetsBuildit, locallly with only Dir buttons

- [ ] **Step 2: Start the Goalspace services and confirm the dot turns green**

```powershell
Start-ScheduledTask 'Goalspace'
```

Wait ~15 seconds, then reload http://homeslice.localhost. The goalspace dot should turn green within 30 seconds (next poll cycle), or refresh the page to trigger an immediate check.

- [ ] **Step 3: Verify the Dir button works**

Click any Dir button — Windows Explorer should open to that project's directory.

- [ ] **Step 4: Add slimRDM (optional — outside C:\Apps)**

Create `C:\Users\KingKarl\slimRDM\homeslice.json`:

```json
{
  "name": "slimRDM",
  "description": "Lightweight RDP & SSH client (native app)",
  "tech": "Tauri + React",
  "section": "desktop"
}
```

Then add `'C:\\Users\\KingKarl\\slimRDM'` to the `SCAN_ROOTS` array at the top of `open-dir-server.mjs` (after `'C:\\Apps'`), restart the helper (same commands as Task 1 Step 2), and reload the dashboard to confirm slimRDM appears.
