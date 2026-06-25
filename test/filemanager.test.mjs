import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linuxFileManagerSpec } from '../filemanager.mjs';

test('prefers xdg-open (the desktop-agnostic opener)', () => {
  const spec = linuxFileManagerSpec('/home/x', b => b === 'xdg-open' || b === 'nautilus');
  assert.deepEqual(spec, { bin: 'xdg-open', args: ['/home/x'] });
});

test('falls back to a specific file manager when xdg-open is absent', () => {
  const spec = linuxFileManagerSpec('/p', b => b === 'nautilus');
  assert.deepEqual(spec, { bin: 'nautilus', args: ['/p'] });
});

test('returns null when no file manager is available', () => {
  assert.equal(linuxFileManagerSpec('/p', () => false), null);
});
