// Windows Task Scheduler control for the dashboard's "Services" panel.
// Kept as its own module (matching giturl.mjs / terminal.mjs / filemanager.mjs /
// appdetect.mjs) so the helpers are directly importable by tests.
import { execFileSync } from 'node:child_process';
import { existsSync, openSync, closeSync, fstatSync, readSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const PS_EXE = process.env.windir + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
export const VALID_ACTIONS = ['start', 'stop', 'enable', 'disable', 'restart'];
const MAX_LOG_BYTES = 200 * 1024;

// Get-ScheduledTask's State is a real PowerShell enum and normally prints as
// "Ready"/"Running"/etc, but ConvertTo-Json in a minimal -NoProfile session can
// serialize the raw TASK_STATE ordinal instead (observed: "3" not "Ready").
// Normalize either shape to the friendly name so callers never see a bare digit.
const TASK_STATE_NAMES = { 0: 'Unknown', 1: 'Disabled', 2: 'Queued', 3: 'Ready', 4: 'Running' };
function normalizeState(raw) {
  const s = String(raw);
  return /^\d+$/.test(s) ? (TASK_STATE_NAMES[Number(s)] ?? s) : s;
}

function hslError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Safe to splice into a single-quoted PowerShell string literal.
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// Real PowerShell invocation. Tests inject a fake in place of this.
// execFileSync (no shell) so the command string never needs cmd.exe-level
// quoting on top of PowerShell's own — one less layer of escaping to get wrong.
export function runPs(cmd, timeout) {
  return execFileSync(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout });
}

export function isValidAction(action) {
  return VALID_ACTIONS.includes(action);
}

// Batch-query Task Scheduler state for a set of task names in one PowerShell
// call (avoids spinning up a process per task). Names Task Scheduler doesn't
// recognize are simply omitted by -ErrorAction SilentlyContinue; callers get
// state:null for any requested name not present in the result.
export function getServiceStatuses(taskNames, ps = runPs) {
  const names = [...new Set((taskNames || []).filter(Boolean))];
  const result = {};
  for (const n of names) result[n] = { state: null };
  if (!names.length) return result;

  const namesLiteral = names.map(psQuote).join(',');
  const cmd = 'Get-ScheduledTask -TaskName ' + namesLiteral +
    ' -ErrorAction SilentlyContinue | Select-Object TaskName, State | ConvertTo-Json -Compress';

  let out;
  try {
    out = ps(cmd, 8000).trim();
  } catch {
    return result; // powershell itself failed to run — everything stays state:null
  }
  if (!out) return result;

  let parsed;
  try { parsed = JSON.parse(out); } catch { return result; }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  for (const row of rows) {
    if (row && typeof row.TaskName === 'string') {
      result[row.TaskName] = { state: normalizeState(row.State) };
    }
  }
  return result;
}

const ACTION_CMDS = {
  start:   (q) => 'Start-ScheduledTask -TaskName ' + q,
  stop:    (q) => 'Stop-ScheduledTask -TaskName ' + q,
  enable:  (q) => 'Enable-ScheduledTask -TaskName ' + q,
  disable: (q) => 'Disable-ScheduledTask -TaskName ' + q,
  restart: (q) => 'Stop-ScheduledTask -TaskName ' + q + ' -ErrorAction SilentlyContinue; ' +
                  'Start-Sleep -Milliseconds 700; Start-ScheduledTask -TaskName ' + q,
};

// Start/Stop/Restart work fine from a non-elevated caller — Task Scheduler
// elevates the task's own action internally using its stored principal.
// Enable/Disable modify the task's persisted definition instead, and that
// consistently requires the CALLER to be elevated too (observed: fails with
// "Access is denied" even for a task registered at Limited run-level) — so
// those two go through a one-shot elevated child process instead.
const ELEVATED_ACTIONS = new Set(['enable', 'disable']);

// Runs one Task Scheduler cmdlet in an elevated child process. -Verb RunAs
// can't redirect stdio directly, so the child writes its own result to a temp
// log file that we read back afterward. Real UAC prompts (outside this silently-
// elevating environment) can take a while, hence the generous timeout.
function runElevated(taskName, action) {
  const id = randomBytes(6).toString('hex');
  const scriptPath = join(tmpdir(), 'hsl-svc-' + id + '.ps1');
  const logPath = join(tmpdir(), 'hsl-svc-' + id + '.log');
  const inner = ACTION_CMDS[action](psQuote(taskName));
  const script =
    'try {\r\n' +
    '  ' + inner + '\r\n' +
    '  "OK" | Out-File -FilePath ' + psQuote(logPath) + ' -Encoding utf8\r\n' +
    '} catch {\r\n' +
    '  ("ERROR: " + $_.Exception.Message) | Out-File -FilePath ' + psQuote(logPath) + ' -Encoding utf8\r\n' +
    '}\r\n';
  writeFileSync(scriptPath, script, 'utf8');

  try {
    const launcher = 'Start-Process -FilePath ' + psQuote(PS_EXE) +
      " -ArgumentList '-NoProfile','-NonInteractive','-File'," + psQuote(scriptPath) +
      ' -Verb RunAs -Wait';
    execFileSync(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', launcher], { encoding: 'utf8', timeout: 60000 });

    const result = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : '';
    if (result !== 'OK') {
      throw hslError(
        'Failed to ' + action + ' "' + taskName + '": ' + (result || 'no result — elevation prompt may have been dismissed'),
        'EEXEC'
      );
    }
  } catch (e) {
    if (e.code === 'EEXEC') throw e;
    throw hslError('Failed to ' + action + ' "' + taskName + '": ' + (e.message || '').trim(), 'EEXEC');
  } finally {
    try { unlinkSync(scriptPath); } catch {}
    try { unlinkSync(logPath); } catch {}
  }
}

// Run a Task Scheduler action for one task. Throws a tagged error the server
// maps to an HTTP status. Existence of the task is the caller's job to have
// checked already (via getServiceStatuses) — acting on an unregistered task
// just fails here with EEXEC.
export function runServiceAction(taskName, action, ps = runPs, elevate = runElevated) {
  if (!isValidAction(action)) throw hslError('Unknown action: ' + action, 'EVALIDATION');
  if (ELEVATED_ACTIONS.has(action)) return elevate(taskName, action);
  const q = psQuote(taskName);
  try {
    ps(ACTION_CMDS[action](q), 15000);
  } catch (e) {
    const detail = (e.stderr || e.message || '').toString().trim();
    throw hslError('Failed to ' + action + ' "' + taskName + '": ' + detail, 'EEXEC');
  }
}

// Tail the last maxBytes of a log file without reading the whole thing into
// memory — dev logs can grow unbounded over weeks of unattended uptime.
// Returns null if the file doesn't exist.
export function tailLog(path, maxBytes = MAX_LOG_BYTES) {
  if (!path || !existsSync(path)) return null;
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = '... (truncated)\n' + (nl !== -1 ? text.slice(nl + 1) : text);
    }
    return text;
  } finally {
    closeSync(fd);
  }
}
