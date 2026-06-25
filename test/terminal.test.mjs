import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linuxTerminalSpec } from '../terminal.mjs';

test('picks a known terminal with its working-directory flag', () => {
  const spec = linuxTerminalSpec('/home/x', b => b === 'alacritty');
  assert.deepEqual(spec, { bin: 'alacritty', args: ['--working-directory', '/home/x'] });
});

test('gnome-terminal uses --working-directory=<dir>', () => {
  const spec = linuxTerminalSpec('/p', b => b === 'gnome-terminal');
  assert.deepEqual(spec, { bin: 'gnome-terminal', args: ['--working-directory=/p'] });
});

test('prefers a flag-aware terminal over the x-terminal-emulator fallback', () => {
  const spec = linuxTerminalSpec('/p', b => b === 'gnome-terminal' || b === 'x-terminal-emulator');
  assert.equal(spec.bin, 'gnome-terminal');
});

test('x-terminal-emulator fallback relies on cwd (no args)', () => {
  const spec = linuxTerminalSpec('/p', b => b === 'x-terminal-emulator');
  assert.deepEqual(spec, { bin: 'x-terminal-emulator', args: [] });
});

test('returns null when no terminal emulator is available', () => {
  assert.equal(linuxTerminalSpec('/p', () => false), null);
});
