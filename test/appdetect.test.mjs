import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectAppInfo, writeManifest } from '../appdetect.mjs';

// Create a uniquely-named subdirectory with the requested base name so that
// detectAppInfo's name title-casing can be exercised against a real dir name.
function makeDir(name) {
  const base = mkdtempSync(join(tmpdir(), 'hsl-'));
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return { base, dir };
}

// ── detectAppInfo: name title-casing ─────────────────────────────────────────

test('detectAppInfo title-cases hyphen/underscore/camel directory names', () => {
  for (const [dirName, expected] of [
    ['my-app', 'My App'],
    ['my_app', 'My App'],
    ['MyApp', 'My App'],
    ['homeslice', 'Homeslice'],
  ]) {
    const { dir } = makeDir(dirName);
    assert.equal(detectAppInfo(dir).name, expected);
  }
});

// ── detectAppInfo: tech detection ────────────────────────────────────────────

test('detects Rust / Go / Python by marker files', () => {
  const rust = makeDir('rusty').dir;
  writeFileSync(join(rust, 'Cargo.toml'), '[package]\nname = "rusty"\n');
  assert.equal(detectAppInfo(rust).tech, 'Rust');

  const go = makeDir('gopher').dir;
  writeFileSync(join(go, 'go.mod'), 'module gopher\n');
  assert.equal(detectAppInfo(go).tech, 'Go');

  const py = makeDir('snake').dir;
  writeFileSync(join(py, 'requirements.txt'), 'flask\n');
  assert.equal(detectAppInfo(py).tech, 'Python');
});

test('refines JS tech from package.json dependencies', () => {
  const cases = [
    [{ dependencies: { next: '14' } }, 'Next.js'],
    [{ dependencies: { react: '18' } }, 'React'],
    [{ dependencies: { vue: '3' } }, 'Vue'],
    [{ devDependencies: { svelte: '4' } }, 'Svelte'],
    [{ dependencies: { fastify: '4' } }, 'Fastify'],
    [{ dependencies: { express: '4' } }, 'Express'],
    [{ devDependencies: { vite: '5' } }, 'Vite'],
    [{ dependencies: { lodash: '4' } }, 'Node.js'],
  ];
  for (const [pkg, expected] of cases) {
    const dir = makeDir('jsapp').dir;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    assert.equal(detectAppInfo(dir).tech, expected, JSON.stringify(pkg));
  }
});

test('malformed package.json yields null tech, not a throw', () => {
  const dir = makeDir('broken').dir;
  writeFileSync(join(dir, 'package.json'), '{ not valid json');
  assert.equal(detectAppInfo(dir).tech, null);
});

// ── detectAppInfo: port detection ────────────────────────────────────────────

test('detects port from package.json scripts', () => {
  const dir = makeDir('ported').dir;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    scripts: { dev: 'vite --port 5180' },
  }));
  const info = detectAppInfo(dir);
  assert.equal(info.port, 5180);
  assert.equal(info.url, 'http://localhost:5180');
});

test('detects port from .env', () => {
  const dir = makeDir('enved').dir;
  writeFileSync(join(dir, '.env'), 'FOO=bar\nPORT=4321\n');
  assert.equal(detectAppInfo(dir).port, 4321);
});

test('detects port from vite.config.ts', () => {
  const dir = makeDir('viteapp').dir;
  writeFileSync(join(dir, 'vite.config.ts'), 'export default { server: { port: 5199 } }');
  assert.equal(detectAppInfo(dir).port, 5199);
});

test('no detectable port yields null port and null url', () => {
  const dir = makeDir('bare').dir;
  const info = detectAppInfo(dir);
  assert.equal(info.port, null);
  assert.equal(info.url, null);
  assert.equal(info.tech, null);
});

// ── writeManifest: add ───────────────────────────────────────────────────────

test('add writes a new manifest and omits empty fields', () => {
  const dir = makeDir('addme').dir;
  writeManifest(dir, {
    name: 'Add Me', description: '', tech: 'React', section: 'web',
    url: '', port: '', github: '',
  }, { mode: 'add' });
  const m = JSON.parse(readFileSync(join(dir, 'homeslice.json'), 'utf8'));
  assert.equal(m.name, 'Add Me');
  assert.equal(m.tech, 'React');
  assert.equal(m.section, 'web');
  assert.ok(!('description' in m));
  assert.ok(!('url' in m));
  assert.ok(!('port' in m));
});

test('add refuses when a manifest already exists', () => {
  const dir = makeDir('dupe').dir;
  writeFileSync(join(dir, 'homeslice.json'), '{"name":"Existing"}');
  assert.throws(() => writeManifest(dir, { name: 'New' }, { mode: 'add' }), /already exists/);
});

test('add coerces port to a number', () => {
  const dir = makeDir('portnum').dir;
  writeManifest(dir, { name: 'P', port: '3000' }, { mode: 'add' });
  const m = JSON.parse(readFileSync(join(dir, 'homeslice.json'), 'utf8'));
  assert.equal(m.port, 3000);
  assert.equal(typeof m.port, 'number');
});

test('name is required', () => {
  const dir = makeDir('noname').dir;
  assert.throws(() => writeManifest(dir, { name: '   ' }, { mode: 'add' }), /name is required/i);
});

// ── writeManifest: update (merge-preserve) ───────────────────────────────────

test('update merges over existing manifest and preserves unmanaged keys', () => {
  const dir = makeDir('editme').dir;
  writeFileSync(join(dir, 'homeslice.json'), JSON.stringify({
    name: 'Old Name',
    tech: 'Vue',
    commands: [{ label: 'build', cmd: 'npm run build' }],
    ports: [{ label: 'API', port: 4000 }, { label: 'UI', port: 5002 }],
  }));
  writeManifest(dir, {
    name: 'New Name', description: 'now described', tech: 'Vue', section: 'web',
    url: '', github: '',
  }, { mode: 'update' });
  const m = JSON.parse(readFileSync(join(dir, 'homeslice.json'), 'utf8'));
  assert.equal(m.name, 'New Name');
  assert.equal(m.description, 'now described');
  // unmanaged keys preserved untouched
  assert.deepEqual(m.commands, [{ label: 'build', cmd: 'npm run build' }]);
  assert.deepEqual(m.ports, [{ label: 'API', port: 4000 }, { label: 'UI', port: 5002 }]);
});

test('update refuses when no manifest exists', () => {
  const dir = makeDir('ghost').dir;
  assert.throws(() => writeManifest(dir, { name: 'X' }, { mode: 'update' }), /No manifest exists/);
});

test('update on malformed existing manifest throws a clear error', () => {
  const dir = makeDir('corrupt').dir;
  writeFileSync(join(dir, 'homeslice.json'), '{ broken');
  assert.throws(() => writeManifest(dir, { name: 'X' }, { mode: 'update' }), /not valid JSON/);
});
