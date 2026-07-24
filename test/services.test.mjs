import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isValidAction, getServiceStatuses, runServiceAction, tailLog } from '../services.mjs';

test('isValidAction accepts only the five known verbs', () => {
  assert.equal(isValidAction('start'), true);
  assert.equal(isValidAction('stop'), true);
  assert.equal(isValidAction('enable'), true);
  assert.equal(isValidAction('disable'), true);
  assert.equal(isValidAction('restart'), true);
  assert.equal(isValidAction('delete'), false);
  assert.equal(isValidAction(''), false);
});

test('getServiceStatuses returns state:null for empty input without invoking PowerShell', () => {
  let called = false;
  const result = getServiceStatuses([], () => { called = true; return ''; });
  assert.deepEqual(result, {});
  assert.equal(called, false);
});

test('getServiceStatuses maps a single-object PowerShell result (ConvertTo-Json unwraps single-element arrays)', () => {
  const fakePs = () => JSON.stringify({ TaskName: 'Goalspace', State: 'Ready' });
  const result = getServiceStatuses(['Goalspace'], fakePs);
  assert.deepEqual(result, { Goalspace: { state: 'Ready' } });
});

test('getServiceStatuses maps a multi-object PowerShell result', () => {
  const fakePs = () => JSON.stringify([
    { TaskName: 'Homeslice Caddy', State: 'Running' },
    { TaskName: 'Goalspace', State: 'Ready' },
  ]);
  const result = getServiceStatuses(['Homeslice Caddy', 'Goalspace'], fakePs);
  assert.deepEqual(result, {
    'Homeslice Caddy': { state: 'Running' },
    Goalspace: { state: 'Ready' },
  });
});

test('getServiceStatuses leaves state:null for a name PowerShell did not return (task not registered)', () => {
  const fakePs = () => JSON.stringify({ TaskName: 'Goalspace', State: 'Ready' });
  const result = getServiceStatuses(['Goalspace', 'Nonexistent Task'], fakePs);
  assert.deepEqual(result, {
    Goalspace: { state: 'Ready' },
    'Nonexistent Task': { state: null },
  });
});

test('getServiceStatuses normalizes a raw TASK_STATE ordinal to its friendly name', () => {
  // Observed in practice: ConvertTo-Json in a -NoProfile session can serialize
  // the numeric enum value instead of "Ready"/"Running"/etc.
  const fakePs = () => JSON.stringify([
    { TaskName: 'Homeslice Caddy', State: 3 },
    { TaskName: 'Goalspace', State: '4' },
    { TaskName: 'Affinatrix', State: 1 },
  ]);
  const result = getServiceStatuses(['Homeslice Caddy', 'Goalspace', 'Affinatrix'], fakePs);
  assert.deepEqual(result, {
    'Homeslice Caddy': { state: 'Ready' },
    Goalspace: { state: 'Running' },
    Affinatrix: { state: 'Disabled' },
  });
});

test('getServiceStatuses returns all-null instead of throwing when PowerShell itself fails', () => {
  const fakePs = () => { throw new Error('powershell not found'); };
  const result = getServiceStatuses(['Goalspace'], fakePs);
  assert.deepEqual(result, { Goalspace: { state: null } });
});

test('runServiceAction refuses an unknown action without invoking PowerShell', () => {
  let called = false;
  assert.throws(
    () => runServiceAction('Goalspace', 'delete', () => { called = true; }),
    (e) => e.code === 'EVALIDATION'
  );
  assert.equal(called, false);
});

test('runServiceAction passes the correct cmdlet and a quoted task name for start/stop/restart', () => {
  const seen = [];
  const fakePs = (cmd) => { seen.push(cmd); };
  runServiceAction('Homeslice Caddy', 'start', fakePs);
  runServiceAction('Homeslice Caddy', 'stop', fakePs);
  runServiceAction('Homeslice Caddy', 'restart', fakePs);
  assert.match(seen[0], /^Start-ScheduledTask -TaskName 'Homeslice Caddy'$/);
  assert.match(seen[1], /^Stop-ScheduledTask -TaskName 'Homeslice Caddy'$/);
  assert.match(seen[2], /Stop-ScheduledTask.*Start-ScheduledTask/s);
});

// Enable/Disable modify the task's stored definition, which — unlike
// Start/Stop/Restart — was observed to require an elevated caller even for a
// task registered at Limited run-level. They're routed to a separate
// elevate() path instead of the plain ps() one Start/Stop/Restart use.
test('runServiceAction routes enable/disable to the elevate() path, not ps()', () => {
  let psCalled = false;
  const fakePs = () => { psCalled = true; };
  const seenElevated = [];
  const fakeElevate = (taskName, action) => { seenElevated.push([taskName, action]); };
  runServiceAction('Homeslice Caddy', 'enable', fakePs, fakeElevate);
  runServiceAction('Homeslice Caddy', 'disable', fakePs, fakeElevate);
  assert.equal(psCalled, false);
  assert.deepEqual(seenElevated, [['Homeslice Caddy', 'enable'], ['Homeslice Caddy', 'disable']]);
});

test('runServiceAction escapes an embedded single quote in the task name', () => {
  const seen = [];
  runServiceAction("Bob's Task", 'start', (cmd) => seen.push(cmd));
  assert.match(seen[0], /'Bob''s Task'/);
});

test('runServiceAction wraps a PowerShell failure in an EEXEC error', () => {
  const fakePs = () => { const e = new Error('boom'); e.stderr = 'Access is denied'; throw e; };
  assert.throws(
    () => runServiceAction('Goalspace', 'start', fakePs),
    (e) => e.code === 'EEXEC' && e.message.includes('Access is denied')
  );
});

function tmpFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'hsl-log-'));
  const file = join(dir, 'test.log');
  if (content != null) writeFileSync(file, content, 'utf8');
  return file;
}

test('tailLog returns null for a missing file', () => {
  assert.equal(tailLog(join(tmpdir(), 'does-not-exist-' + Date.now() + '.log')), null);
});

test('tailLog returns the whole file when it is under the byte cap', () => {
  const file = tmpFile('line one\nline two\n');
  assert.equal(tailLog(file), 'line one\nline two\n');
});

test('tailLog truncates and drops the partial first line when over the byte cap', () => {
  const lines = [];
  for (let i = 0; i < 1000; i++) lines.push('line ' + i);
  const content = lines.join('\n') + '\n';
  const file = tmpFile(content);
  const tailed = tailLog(file, 200); // small cap forces truncation
  assert.match(tailed, /^\.\.\. \(truncated\)\n/);
  assert.ok(tailed.length < content.length);
  assert.ok(tailed.endsWith('line 999\n'));
});

test('tailLog returns empty string for an empty file', () => {
  const file = tmpFile('');
  assert.equal(tailLog(file), '');
});
