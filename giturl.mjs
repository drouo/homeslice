// Normalize a git remote URL into a browsable https URL.
// Handles scp-style SSH (git@host:owner/repo.git), ssh://, git://, and https
// remotes, stripping any trailing .git. Returns null if the result can't be a
// safe http(s) link (so the frontend simply omits the GitHub button).
export function toBrowserUrl(remote) {
  if (!remote) return null;
  let url = String(remote).trim();
  if (!url) return null;

  const scp = url.match(/^[\w.+-]+@([^:/]+):(.+)$/);
  if (scp) {
    url = 'https://' + scp[1] + '/' + scp[2];
  } else if (url.startsWith('ssh://')) {
    url = url.replace(/^ssh:\/\/(?:[^@/]+@)?/, 'https://');
  } else if (url.startsWith('git://')) {
    url = url.replace(/^git:\/\//, 'https://');
  }

  url = url.replace(/\.git$/, '');

  return /^https?:\/\//.test(url) ? url : null;
}
