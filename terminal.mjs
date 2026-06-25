import { execSync } from 'node:child_process';

// True if `bin` is on PATH. Uses `command -v` so it works on any POSIX shell.
export function binExists(bin) {
  try {
    execSync('command -v ' + bin, { stdio: 'ignore', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

// Pick a terminal emulator and the args that open it at `dir`.
// Flag-aware terminals come first; x-terminal-emulator/xterm are cwd-based
// fallbacks (we pass cwd via the spawn options instead of a flag).
// Returns { bin, args } or null if nothing suitable is installed.
export function linuxTerminalSpec(dir, has = binExists) {
  const candidates = [
    ['gnome-terminal',     ['--working-directory=' + dir]],
    ['konsole',            ['--workdir', dir]],
    ['xfce4-terminal',     ['--working-directory=' + dir]],
    ['tilix',              ['--working-directory=' + dir]],
    ['kitty',              ['--directory', dir]],
    ['alacritty',          ['--working-directory', dir]],
    ['x-terminal-emulator', []],
    ['xterm',              []],
  ];
  for (const [bin, args] of candidates) {
    if (has(bin)) return { bin, args };
  }
  return null;
}
