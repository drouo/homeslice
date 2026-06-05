# Homeslice: Dynamic Projects + Service Status Dots

**Date:** 2026-06-04
**Scope:** `C:\Apps\Homeslice`

---

## Goal

Replace the hardcoded project list in `index.html` with a dynamic feed so that dropping a `homeslice.json` file into any `C:\Apps\<project>` directory automatically adds it to the dashboard. Each project card with a `port` field shows a live green/red status dot.

---

## `homeslice.json` manifest schema

Placed in a project's root directory to opt it into the dashboard.

```json
{
  "name": "Goalspace",
  "description": "Full-stack goals & productivity app",
  "tech": "Fastify + React",
  "section": "web",
  "url": "http://goalspace.localhost",
  "port": 4040
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Display name |
| `description` | no | Subtitle under the name |
| `tech` | no | Badge text (e.g. `Fastify + React`) |
| `section` | no | `web` \| `desktop` \| `docs` — defaults to `web` |
| `url` | no | Omit → no Open button |
| `port` | no | Local port to ping for status; omit → no dot |

Auto-derived (not written in the manifest):
- **`dir`** — the directory containing the manifest (`C:\Apps\<name>`)
- **`github`** — remote origin URL read from `.git/config`; omit → no GitHub button

---

## Helper server (`open-dir-server.mjs`)

Add a `GET /projects` endpoint alongside the existing `/open-dir` handler.

**Logic:**
1. Read all files matching `C:\Apps\*\homeslice.json` using `fs.readdirSync` + filter
2. Parse each JSON file; derive `dir` from its parent directory path
3. For each project dir, attempt to read `.git/config`; extract the `url =` line under `[remote "origin"]` as `github`
4. Return `Content-Type: application/json` with the array sorted: `web` first, then `desktop`, then `docs`, then alpha by `name` within each group

**Error handling:** If a `homeslice.json` is malformed or unreadable, skip it and continue — never crash the server.

---

## Caddyfile change

Extend the `@opendir` named matcher (renamed `@helper`) to also route `/projects`:

```caddyfile
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

---

## `index.html` rewrite

The static project `<div>` blocks are removed. On `DOMContentLoaded`, the page calls `GET /projects` and renders cards via JS.

**Rendering:**
- Cards are grouped under section headings: `web` → "Web Apps (behind Caddy)", `desktop` → "Desktop Apps", `docs` → "Docs & Planning"; sections with no projects are omitted
- Each card matches the existing `.project` / `.info` / `.links` / `.name` / `.badge` / `.desc` structure
- **Status dot:** `<span class="dot dot-red" id="status-<slugified-name>">` inserted as the first child of `.name`; only rendered when `port` is present. Slug = `name` lowercased with spaces replaced by hyphens (e.g. `"Terminal Fantasy"` → `status-terminal-fantasy`)
- **Open button:** rendered only when `url` is present
- **Dir button:** always rendered (dir is always available)
- **GitHub button:** rendered only when `github` is present

**Status checks:**
- `checkServices()` runs on page load and every 30 seconds
- For each card with a `port`: `fetch('http://localhost:<port>', { mode: 'no-cors' })` → resolve sets `dot-green`, reject sets `dot-red`
- Checks for all ports run in parallel via `Promise.allSettled`

**Error handling:** If `/projects` fetch fails, render a single error card in place of the list with a retry button.

---

## Files changed

| File | Change |
|------|--------|
| `C:\Apps\Homeslice\open-dir-server.mjs` | Add `GET /projects` endpoint |
| `C:\Apps\caddy\Caddyfile` | Extend matcher; rename `@opendir` → `@helper` |
| `C:\Apps\Homeslice\index.html` | Remove static cards; add JS rendering + status dots |

**New files created per project** (not part of this implementation — user adds as needed):
- `C:\Apps\<project>\homeslice.json`

Existing projects to wire up immediately: Affinatrix, Goalspace, Serverspace, slimRDM, TerminalFantasy, Latin, LetsBuildit, locallly.

---

## Out of scope

- Authentication / access control
- Editing manifests from the UI
- Projects outside `C:\Apps\`
- Hot-reload on manifest file changes (page refresh is sufficient)
