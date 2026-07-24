// App auto-detection and manifest writing for the "add / edit app" UI flows.
// Kept as its own module (matching giturl.mjs / terminal.mjs / filemanager.mjs)
// so the helpers are directly importable by tests without starting the server.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toBrowserUrl } from './giturl.mjs';

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'homeslice.config.json');

// Fields the form manages; everything else in an existing manifest is preserved.
export const MANAGED_FIELDS = ['name', 'description', 'tech', 'section', 'url', 'port', 'github', 'scheduledTask', 'logPath'];

// ── Shared config / git helpers (one implementation, reused by the detector) ───

export function loadConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (Array.isArray(config.scanRoots) && config.scanRoots.length > 0) {
      return config.scanRoots;
    }
  } catch {}
  return ['C:\\Apps'];
}

export function readGithubUrl(projectDir) {
  const gitConfig = join(projectDir, '.git', 'config');
  if (!existsSync(gitConfig)) return null;
  try {
    const text = readFileSync(gitConfig, 'utf8');
    const match = text.match(/\[remote "origin"\][^\[]*?url\s*=\s*([^\n\r]+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// ── Detection ──────────────────────────────────────────────────────────────────

// "my-app" / "my_app" / "MyApp" -> "My App". All-caps words (acronyms) kept as-is.
function titleCaseName(base) {
  const spaced = base
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function detectTech(dir) {
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      let pkg;
      try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); }
      catch { return null; } // malformed -> no guess rather than throwing
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.next) return 'Next.js';
      if (deps.react) return 'React';
      if (deps.vue) return 'Vue';
      if (deps.svelte) return 'Svelte';
      if (deps.fastify) return 'Fastify';
      if (deps.express) return 'Express';
      if (deps.vite) return 'Vite';
      return 'Node.js';
    }
    if (existsSync(join(dir, 'Cargo.toml'))) return 'Rust';
    if (existsSync(join(dir, 'go.mod'))) return 'Go';
    if (existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'requirements.txt'))) return 'Python';
  } catch {}
  return null;
}

function detectPort(dir) {
  // 1. package.json scripts: "--port 5173" / "--port=5173"
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      for (const val of Object.values(pkg.scripts || {})) {
        const m = String(val).match(/--port[= ]?(\d{2,5})/);
        if (m) return Number(m[1]);
      }
    }
  } catch {}
  // 2. .env then .env.example: PORT=3000
  for (const f of ['.env', '.env.example']) {
    try {
      const p = join(dir, f);
      if (existsSync(p)) {
        const m = readFileSync(p, 'utf8').match(/^PORT\s*=\s*(\d{2,5})/m);
        if (m) return Number(m[1]);
      }
    } catch {}
  }
  // 3. vite.config.{js,ts,mjs}: port: 5173
  for (const f of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']) {
    try {
      const p = join(dir, f);
      if (existsSync(p)) {
        const m = readFileSync(p, 'utf8').match(/port\s*:\s*(\d{2,5})/);
        if (m) return Number(m[1]);
      }
    } catch {}
  }
  return null;
}

// Inspect a single directory and return auto-detected manifest fields. Never
// throws on malformed/missing project files — each probe is independently guarded.
export function detectAppInfo(dir) {
  const abs = resolve(dir);
  const port = detectPort(abs);
  return {
    dir: abs,
    name: titleCaseName(basename(abs)),
    description: null,
    tech: detectTech(abs),
    section: 'web',
    url: port ? 'http://localhost:' + port : null,
    port,
    github: toBrowserUrl(readGithubUrl(abs)),
  };
}

// Directories under the configured scan roots that have no homeslice.json yet,
// each auto-detected. Sorted by detected name.
export function listUnclaimed() {
  const results = [];
  for (const root of loadConfig()) {
    let entries;
    try { entries = readdirSync(root, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue; // skip hidden / infra dirs
      const dir = join(root, entry.name);
      if (existsSync(join(dir, 'homeslice.json'))) continue;
      results.push(detectAppInfo(dir));
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

// ── Manifest writing (shared by add + update) ────────────────────────────────

function hslError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Write (add) or merge-update (update) a homeslice.json. In update mode the
// existing manifest is read first and managed fields are overlaid, so unmanaged
// keys (commands, multi-port `ports`, anything custom) are preserved.
// Throws errors tagged with a `code` the server maps to HTTP status.
export function writeManifest(dir, fields, { mode } = {}) {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw hslError('Directory does not exist', 'ENOENT_DIR');
  }

  const manifestPath = join(abs, 'homeslice.json');
  const manifestExists = existsSync(manifestPath);
  if (mode === 'add' && manifestExists) {
    throw hslError('A manifest already exists for this directory.', 'EXISTS');
  }
  if (mode === 'update' && !manifestExists) {
    throw hslError('No manifest exists for this directory.', 'ENOENT_MANIFEST');
  }

  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (!name) throw hslError('A name is required.', 'EVALIDATION');

  let base = {};
  if (mode === 'update') {
    try { base = JSON.parse(readFileSync(manifestPath, 'utf8')); }
    catch { throw hslError('The existing manifest is not valid JSON — edit it by hand.', 'EBADJSON'); }
  }

  const out = { ...base };
  for (const key of MANAGED_FIELDS) {
    let v = fields[key];
    if (key === 'port') {
      v = (v === '' || v == null) ? null : Number(v);
      if (v != null && !Number.isFinite(v)) v = null;
    } else if (typeof v === 'string') {
      v = v.trim();
    }
    if (v === '' || v == null) delete out[key]; // omit empties, keep manifests clean
    else out[key] = v;
  }
  out.name = name; // required field always present

  writeFileSync(manifestPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}
