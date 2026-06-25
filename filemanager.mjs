import { binExists } from './terminal.mjs';

// Pick a file manager to reveal `dir`. xdg-open respects the user's default
// and works across desktops, so it's tried first; the rest are explicit
// fallbacks. They all take the directory as a single argument.
// Returns { bin, args } or null if nothing suitable is installed.
export function linuxFileManagerSpec(dir, has = binExists) {
  const candidates = ['xdg-open', 'nautilus', 'dolphin', 'thunar', 'nemo', 'pcmanfm'];
  for (const bin of candidates) {
    if (has(bin)) return { bin, args: [dir] };
  }
  return null;
}
