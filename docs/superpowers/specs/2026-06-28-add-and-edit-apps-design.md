# Add & Edit Apps from the Homeslice UI — Design

**Date:** 2026-06-28
**Status:** Approved

## Problem

Today, an app only appears on the Homeslice dashboard if it already has a
`homeslice.json` manifest in its root. Creating that file is a manual,
hand-authored step: the user has to know the schema, type the JSON, and place it
in the right directory. There is no way to register a new app — or edit an
existing one's manifest — from the dashboard itself.

We want to make adding and editing apps easy and discoverable from the UI:

- **Surface unregistered directories.** Show directories under the configured
  `scanRoots` that don't yet have a `homeslice.json`, so they can be added with a
  click.
- **Auto-detect as much as possible.** Pre-fill name, GitHub URL, tech stack, and
  port from the project's files; the user just reviews and tweaks.
- **Add from anywhere.** A header `+` button lets the user point at an arbitrary
  path (even outside `scanRoots`) and register it.
- **Edit existing manifests.** Every active project card gets an Edit button that
  opens the same form pre-filled with current values.

## Goals

- One-click "Add" from a detected, auto-filled card.
- Manual "Add app" for arbitrary paths via a header button.
- Inline Edit for every registered app.
- A single shared form component used by all three flows (add-from-unclaimed,
  add-manual, edit).
- Editing preserves manifest fields the form doesn't manage (e.g. `commands`,
  multi-`ports`).

## Non-Goals

- No deletion of apps / manifests from the UI (out of scope for this iteration).
- No multi-port (`ports` array) editing through the form — those configs are
  preserved untouched and the user is directed to edit the file directly.
- No `commands` editing through the form.
- No authentication changes — this remains a localhost-only tool.

## Architecture Overview

```
Browser (index.html)
  │
  ├─ GET  /projects        existing — registered apps (unchanged)
  ├─ GET  /unclaimed       NEW — dirs under scanRoots with no homeslice.json,
  │                              each batch-auto-detected
  ├─ GET  /detect?path=    NEW — auto-detect one arbitrary path (for + button)
  ├─ POST /add-app         NEW — write a new homeslice.json (409 if exists)
  └─ POST /update-app      NEW — merge-update an existing homeslice.json (404 if missing)
```

All new endpoints live in `open-dir-server.mjs` alongside the existing handlers.

## Server Design

The detection and write helpers live in a **new module `appdetect.mjs`**,
following the existing codebase convention where reusable logic sits in its own
`.mjs` file (`giturl.mjs`, `terminal.mjs`, `filemanager.mjs`) and
`open-dir-server.mjs` imports it. This keeps the helpers directly importable by
tests with no need to guard the server's `.listen()` call. `open-dir-server.mjs`
imports them and wires up the four new HTTP endpoints.

`appdetect.mjs` exports `detectAppInfo`, `listUnclaimed`, and `writeManifest`. It
reuses `readGithubUrl`/`toBrowserUrl` (the git-URL helper is already in
`giturl.mjs`; `readGithubUrl` currently lives in `open-dir-server.mjs` and moves
to — or is shared with — `appdetect.mjs` so both the project loader and the
detector use one implementation). `listUnclaimed` needs the configured scan
roots, so the `loadConfig()` logic is likewise shared (passed in or co-located)
rather than duplicated.

### Helper: `detectAppInfo(dir)`

Pure-ish function that inspects a single directory and returns auto-detected
fields. Used by both `/unclaimed` (batch) and `/detect` (single).

Returns:

```js
{
  dir,                // absolute path
  name,               // title-cased directory name, e.g. "my-app" -> "My App"
  description: null,  // not auto-detected; user fills in
  tech,               // detected stack string or null
  section: 'web',     // always defaults to web
  url,                // "http://localhost:<port>" if a port was found, else null
  port,               // detected port number or null
  github,             // toBrowserUrl(readGithubUrl(dir)) — reuse existing helper
}
```

**Name:** take the directory's base name, split on `-`/`_`/whitespace, title-case
each word, join with spaces.

**GitHub:** reuse the existing `readGithubUrl(dir)` + `toBrowserUrl(...)`.

**Tech detection** (first match wins, but JS gets a refinement pass):

| Marker file | Base tech |
|-------------|-----------|
| `package.json` | `Node.js` (refined below) |
| `Cargo.toml` | `Rust` |
| `go.mod` | `Go` |
| `pyproject.toml` / `requirements.txt` | `Python` |

For `package.json`, read `dependencies` + `devDependencies` and refine:
`next` → `Next.js`, `react` → `React`, `vue` → `Vue`, `svelte` → `Svelte`,
`vite` (and nothing more specific) → `Vite`, `fastify` → `Fastify`,
`express` → `Express`. If none match, keep `Node.js`. Detection is best-effort;
a parse failure yields `null` tech rather than throwing.

**Port detection** (first hit wins):

1. `package.json` scripts — regex `--port[= ]?(\d{2,5})` across all script values.
2. `.env` then `.env.example` — regex `^PORT\s*=\s*(\d{2,5})` (multiline).
3. `vite.config.{js,ts,mjs}` — regex `port\s*:\s*(\d{2,5})`.

All file reads are wrapped so a missing/unreadable file is simply skipped.

### Helper: `listUnclaimed()`

Mirrors `loadProjects()`'s directory walk: for each `root` in `loadConfig()`,
read its immediate subdirectories; for each directory **without** a
`homeslice.json`, call `detectAppInfo(dir)` and collect the result. Sorted by
name. Returns the array.

### Helper: `writeManifest(dir, fields, { mode })`

Single shared writer for both add and update.

- `mode: 'add'` — error (409 semantics) if `homeslice.json` already exists.
- `mode: 'update'` — error (404 semantics) if it does **not** exist; read the
  existing JSON first and shallow-merge the incoming form fields over it, so
  unmanaged keys (`commands`, multi-`ports`, anything custom) are preserved.

Form fields written: `name`, `description`, `tech`, `section`, `url`, `port`,
`github`. Empty-string / null fields are omitted from the written object rather
than written as empty values (keeps manifests clean). `name` is required and
validated as a non-empty string; the write is refused otherwise.

The path is validated before writing (see Security).

### Endpoints

- **`GET /unclaimed`** → `{ unclaimed: [ detectAppInfo(...) , ... ] }`,
  `Access-Control-Allow-Origin: *`.
- **`GET /detect?path=<dir>`** → `detectAppInfo(dir)` for one path, or `400` if
  `path` is missing, or `404` if the directory doesn't exist.
- **`POST /add-app`** — body `{ dir, name, description, tech, section, url, port,
  github }`. Calls `writeManifest(dir, fields, { mode: 'add' })`. Returns
  `{ ok: true }` on success, `409` if a manifest already exists, `400` on
  validation failure, `403` if the path isn't allowed.
- **`POST /update-app`** — same body shape. Calls `writeManifest(dir, fields,
  { mode: 'update' })`. Returns `{ ok: true }`, `404` if no manifest exists,
  `400`/`403` as above.

### Security / path validation

The existing `/run` endpoint validates `dir` against the loaded project list.
For these new endpoints we validate differently because the target may *not* be
a registered project yet:

- The directory must exist (`existsSync` + is a directory).
- The directory must be an **immediate child of one of the configured
  `scanRoots`**, OR (for the `+` manual flow) any existing directory the user
  explicitly typed. Per the brainstorm, the `+` button intentionally allows
  arbitrary existing paths. We still require the path to exist and to be a
  directory, and we reject paths containing `homeslice.json` traversal tricks by
  resolving to an absolute real path before use.
- `/update-app` additionally requires that a `homeslice.json` already exists at
  the path.

This keeps parity with the localhost-only, trusted-operator threat model already
documented in the README.

## Client Design (`index.html`)

### Shared form: `renderAppForm(data, mode)`

Produces the inline form markup. `mode` ∈ `'add' | 'edit'`. `data` carries the
field values (auto-detected, or the project's current manifest values) plus
`dir`.

Fields: `name` (required text), `description` (text), `tech` (text),
`section` (select: web/desktop/docs), `url` (text), `port` (number),
`github` (text). Buttons: **Save**, **Cancel**.

- **Save** → POST to `/add-app` (mode `add`) or `/update-app` (mode `edit`) with
  the collected field values, then call `init()` to re-render the dashboard.
- **Cancel** → collapse the form (re-render without it).
- Errors from the server render inline inside the form (e.g. "A manifest already
  exists for this directory.").

**Multi-port guard:** if `data` already contains a `ports` array (multi-port
config, only possible in edit mode), the single `port` input is hidden and
replaced with a note: *"This app uses a multi-port config — edit homeslice.json
directly to change ports."* The `ports` array is preserved server-side via the
merge in `writeManifest`.

### Active project cards — Edit button

`renderCard()` gains an **Edit** button alongside Term/Dir/Cmd. Clicking it
toggles an inline form (reusing the same expand/collapse pattern as the Cmd
panel) pre-filled from the project's current values in `mode: 'edit'`.

### Unclaimed section

A permanently-visible **"Not Yet Added"** section renders below the
`web`/`desktop`/`docs` sections, with dimmed styling. Each unclaimed card shows
the detected name + an "unclaimed" badge, detected tech, the directory path, and
an **Add** button. Add expands the shared form in `mode: 'add'` pre-filled with
the detected values. On Save the card disappears from this section and appears in
its real section after refresh.

The dashboard fetches `/unclaimed` alongside `/projects` during `init()`.

### Header — `+ Add app` button

A `+ Add app` control in the header opens the shared form at the top of the
dashboard with one extra **directory path** input (since there's no card to
anchor it). When the user enters a path and triggers detection (on blur or a
"Detect" affordance), the client calls `GET /detect?path=` and fills the form
with the result; the user then reviews and Saves via `/add-app`.

## Data Flow

**Add from unclaimed:**
`init()` → `GET /unclaimed` → render dimmed cards → user clicks Add → inline
form pre-filled → Save → `POST /add-app` → `init()` re-render (card now a real
project).

**Add manual:**
Header `+` → form with path input → user types path → `GET /detect?path=` →
form filled → Save → `POST /add-app` → `init()`.

**Edit:**
User clicks Edit on a project card → inline form pre-filled from current manifest
values → Save → `POST /update-app` (merge-preserve) → `init()`.

## Error Handling

- Server endpoints return JSON `{ error }` with appropriate status codes
  (`400` validation, `403` path not allowed, `404` missing manifest/dir, `409`
  manifest already exists, `500` write failure).
- The client surfaces these inline in the form rather than via alert dialogs.
- `detectAppInfo` never throws on malformed/missing project files — each probe is
  independently guarded and contributes `null` on failure.
- Malformed existing manifests on `/update-app` (unparseable JSON) return `400`
  with a clear message rather than silently overwriting.

## Testing

New file `test/appdetect.test.mjs` (node:test, matching the existing
`test/*.test.mjs` convention), exercising the exported helpers against temp
directories created per-test:

- **`detectAppInfo`**
  - Name title-casing from `my-app`, `my_app`, `MyApp`-style names.
  - Tech detection for each ecosystem (Cargo/Go/Python) and JS refinement
    (React/Next/Vite/Fastify/Express/plain Node).
  - Port sniffing from `package.json` scripts, `.env`, and `vite.config`.
  - Graceful nulls when nothing is detectable / files are malformed.
- **`writeManifest`**
  - `add` writes a new manifest; refuses when one already exists.
  - `update` merges over an existing manifest and **preserves** unmanaged keys
    (`commands`, `ports`); refuses when none exists.
  - Empty/null fields are omitted from the written JSON.
  - `name` required — write refused without it.

The helpers live in `appdetect.mjs` (see Server Design), so tests import them
directly — `import { detectAppInfo, writeManifest } from '../appdetect.mjs'` —
exactly as `giturl.test.mjs` imports from `../giturl.mjs`. No server process is
started by the test import.

## Documentation

Update `README.md`:

- The "Adding a project" section gains a note that apps can now be added and
  edited from the dashboard (unclaimed section, `+ Add app`, per-card Edit), with
  the manual-JSON method documented as the still-supported fallback.
- List the four new endpoints in the architecture diagram.

## File-by-File Summary

| File | Change |
|------|--------|
| `appdetect.mjs` | New — `detectAppInfo`, `listUnclaimed`, `writeManifest`; shared `readGithubUrl`/config logic |
| `open-dir-server.mjs` | Import `appdetect.mjs`; add `/unclaimed`, `/detect`, `/add-app`, `/update-app` handlers |
| `index.html` | Add `renderAppForm`; Edit button on project cards; "Not Yet Added" section; `+ Add app` header button; fetch `/unclaimed` in `init()` |
| `test/appdetect.test.mjs` | New — tests for `detectAppInfo` and `writeManifest` |
| `README.md` | Document UI add/edit flows and new endpoints |
