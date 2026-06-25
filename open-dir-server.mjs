import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { networkInterfaces, hostname as osHostname } from 'node:os';
import { linuxTerminalSpec } from './terminal.mjs';
import { linuxFileManagerSpec } from './filemanager.mjs';

const PORT = 3456;
const SECTION_ORDER = { web: 0, desktop: 1, docs: 2 };
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'homeslice.config.json');
const MAX_OUTPUT = 100 * 1024;
const CMD_TIMEOUT = 120000;
const PS_EXE = process.env.windir + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

// ── Interactive session launcher ──────────────────────────────────────────────
// Services run in Session 0, isolated from the user's desktop. Direct spawn()
// of explorer.exe, wt.exe etc. won't open visible windows. Instead we create a
// one-shot scheduled task that runs in the interactive (user) session.
// ──────────────────────────────────────────────────────────────────────────────

let interactiveUser = null;

function detectInteractiveUser() {
  // Method 1: WMI — works from Session 0 services
  try {
    const out = execSync(
      '"' + PS_EXE + '" -NoProfile -c "(Get-CimInstance Win32_ComputerSystem).UserName"',
      { encoding: 'utf8', timeout: 5000, shell: 'cmd.exe' }
    );
    const user = out.trim();
    if (user && !user.endsWith('$') && user.length > 0) {
      interactiveUser = user.includes('\\') ? user.split('\\')[1] : user;
      console.log('Detected interactive user (WMI):', interactiveUser);
      return;
    }
  } catch (e) {
    console.error('WMI user detection failed:', e.message);
  }

  // Method 2: query session
  try {
    const out = execSync('query user', { encoding: 'utf8', timeout: 5000 });
    for (const line of out.split('\n')) {
      if (line.trimStart().startsWith('>')) {
        interactiveUser = line.trim().split(/\s+/)[1];
        console.log('Detected interactive user (query user):', interactiveUser);
        return;
      }
    }
  } catch {}

  interactiveUser = null;
  console.log('Could not detect interactive user');
}

function runInteractive(command) {
  const taskName = '_hsl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const launcherDir = 'C:\\Apps\\.tools\\WinSW';
  const batPath = join(launcherDir, taskName + '.bat');
  const psPath  = join(launcherDir, taskName + '.ps1');

  const user = interactiveUser;
  if (!user) {
    console.error('No interactive user known — cannot launch:', command);
    return;
  }

  console.log('runInteractive: user=' + user + ' cmd=' + command);

  // Write command to a .bat file in a shared location
  writeFileSync(batPath, '@echo off\r\n' + command + '\r\n', 'utf8');

  // PowerShell's Register-ScheduledTask with Interactive logon type
  // Use JSON to pass paths safely, avoiding quote-escaping nightmares
  const paramsJson = JSON.stringify({ batPath, taskName, user });
  const psScript = [
    "$p = '" + paramsJson.replace(/'/g, "''") + "' | ConvertFrom-Json",
    'try {',
    '  $action    = New-ScheduledTaskAction -Execute $p.batPath',
    '  $trigger   = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddSeconds(2))',
    '  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable',
    "  $principal = New-ScheduledTaskPrincipal -UserId $p.user -LogonType Interactive -RunLevel Limited",
    '  Register-ScheduledTask -TaskName $p.taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null',
    '} catch {',
    '  Write-Error ($_ | Out-String)',
    '}',
  ].join('\n');
  writeFileSync(psPath, psScript, 'utf8');
  console.log('runInteractive: ps script written');

  const ps = spawn(PS_EXE, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath]);
  let stdout = '';
  let stderr = '';
  ps.stdout.on('data', d => { stdout += d; });
  ps.stderr.on('data', d => { stderr += d; });
  ps.on('error', (err) => { console.error('PowerShell spawn error:', err.message); });
  ps.on('close', (code) => {
    console.log('runInteractive: PS exited with code=' + code);
    if (code !== 0) {
      console.error('PowerShell launch failed. code=' + code + ' stdout=' + stdout + ' stderr=' + stderr);
    }
    // Cleanup after 60s (long enough for the task to run)
    setTimeout(() => {
      spawn(PS_EXE, [
        '-NoProfile', '-Command',
        "Unregister-ScheduledTask -TaskName '" + taskName + "' -Confirm:$false",
      ], { stdio: 'ignore' });
      try { unlinkSync(batPath); } catch (e) { console.error('cleanup bat error:', e.message); }
      try { unlinkSync(psPath); } catch (e) { console.error('cleanup ps error:', e.message); }
    }, 60000);
  });
}

detectInteractiveUser();

function getHostInfo() {
  const nets = networkInterfaces();
  let ip = null;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }
    }
    if (ip) break;
  }
  return { hostname: osHostname(), ip: ip ?? '127.0.0.1' };
}

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
        const rawPorts = Array.isArray(manifest.ports) ? manifest.ports : null;
        const legacyPort = manifest.port ?? null;
        const ports = rawPorts ?? (legacyPort ? [{ label: 'App', port: legacyPort }] : null);
        projects.push({
          name:        manifest.name,
          description: manifest.description ?? null,
          tech:        manifest.tech ?? null,
          section:     manifest.section ?? 'web',
          url:         manifest.url ?? null,
          ports:       ports,
          port:        ports?.[0]?.port ?? null,
          commands:    Array.isArray(manifest.commands) ? manifest.commands : [],
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

function openDir(dir) {
  if (process.platform !== 'win32') {
    const spec = linuxFileManagerSpec(dir);
    if (!spec) {
      console.error('No file manager found on PATH — cannot open folder:', dir);
      return;
    }
    console.log('openDir: spawning ' + spec.bin + ' for ' + dir);
    const child = spawn(spec.bin, spec.args, {
      detached: true, stdio: 'ignore', env: process.env,
    });
    child.on('error', (err) => console.error('file manager launch error:', err.message));
    child.unref();
    return;
  }
  runInteractive('explorer "' + dir + '"');
}

function openTerminal(dir) {
  if (process.platform !== 'win32') {
    // Linux/macOS: the helper runs in the user's session (it has DISPLAY),
    // so we can spawn a terminal emulator directly — no scheduled-task dance.
    const spec = linuxTerminalSpec(dir);
    if (!spec) {
      console.error('No terminal emulator found on PATH — cannot open terminal for:', dir);
      return;
    }
    console.log('openTerminal: spawning ' + spec.bin + ' in ' + dir);
    const child = spawn(spec.bin, spec.args, {
      cwd: dir, detached: true, stdio: 'ignore', env: process.env,
    });
    child.on('error', (err) => console.error('terminal launch error:', err.message));
    child.unref();
    return;
  }

  const wtPath = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe');
  if (existsSync(wtPath)) {
    runInteractive('wt -d "' + dir + '"');
  } else {
    runInteractive('pwsh -NoExit -Command "Set-Location \'' + dir + '\'"');
  }
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (url.pathname === '/open-dir') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    const dir = url.searchParams.get('path');
    if (dir && dir !== '1') {
      openDir(dir);
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
        const child = spawn(cmd, {
          cwd: dir, shell: true,
          env: {
            ...process.env,
            PATH: process.env.PATH + ';C:\\Program Files\\Git\\mingw64\\libexec\\git-core',
            GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*',
            GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
          },
        });
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
    res.end(JSON.stringify({ host: getHostInfo(), projects }));

  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('open-dir server listening on http://127.0.0.1:' + PORT);
});
