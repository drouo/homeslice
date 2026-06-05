import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const PORT = 3456;
const SECTION_ORDER = { web: 0, desktop: 1, docs: 2 };
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'homeslice.config.json');
const MAX_OUTPUT = 100 * 1024;
const CMD_TIMEOUT = 30000;

function loadConfig() {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    if (Array.isArray(config.scanRoots) && config.scanRoots.length > 0) {
      return config.scanRoots;
    }
  } catch {}
  return ['C:\\Apps'];
}

function readGithubUrl(projectDir) {
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

function loadProjects() {
  const projects = [];
  for (const root of loadConfig()) {
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

function openTerminal(dir) {
  const wtPath = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe');
  if (existsSync(wtPath)) {
    spawn('cmd.exe', ['/c', 'start', '', 'wt', '-d', dir], { detached: true, stdio: 'ignore' });
  } else {
    spawn('cmd.exe', ['/c', 'start', '', 'pwsh', '-NoExit', '-Command', "Set-Location '" + dir + "'"], { detached: true, stdio: 'ignore' });
  }
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (url.pathname === '/open-dir') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    const dir = url.searchParams.get('path');
    if (dir) {
      spawn('cmd.exe', ['/c', 'start', '', 'explorer', dir], { detached: true, stdio: 'ignore' });
    }
    res.end('OK');

  } else if (url.pathname === '/open-term') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    const dir = url.searchParams.get('path');
    if (dir) {
      openTerminal(dir);
    }
    res.end('OK');

  } else if (url.pathname === '/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { dir, cmd, timeout = CMD_TIMEOUT } = JSON.parse(body);
        if (!dir || !cmd) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'dir and cmd are required' }));
          return;
        }
        const projects = loadProjects();
        const valid = projects.some(p => p.dir === dir);
        if (!valid) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Directory not in project list' }));
          return;
        }
        const child = spawn(cmd, { cwd: dir, shell: true });
        let stdout = '', stderr = '';
        let timedOut = false;

        child.stdout.on('data', d => {
          stdout += d;
          if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT) + '\n... (truncated)';
        });
        child.stderr.on('data', d => {
          stderr += d;
          if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT) + '\n... (truncated)';
        });

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
          if (!res.headersSent) {
            res.writeHead(408, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Command timed out', stdout, stderr, timedOut: true }));
          }
        }, timeout);

        child.on('error', () => {
          clearTimeout(timer);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to start command' }));
          }
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exitCode: code, stdout, stderr, timedOut }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });

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
  console.log('open-dir server listening on http://localhost:' + PORT);
});
