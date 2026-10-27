/**
 * Quote a value as a PowerShell single-quoted string literal.
 * PowerShell treats typographic single quotes as quote characters too, so those are doubled as well.
 */
export function psQuote(value: string): string {
  return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`;
}

/** Quote a value as a POSIX shell single-quoted string literal. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote a filesystem path for bash, keeping a leading `~` expandable so `~/code` means the home directory.
 */
export function shPath(path: string): string {
  if (path === '~') return '"$HOME"';
  if (path.startsWith('~/')) return `"$HOME"${shQuote(path.slice(1))}`;
  return shQuote(path);
}

/** Strip trailing separators (but keep roots like `/`, `C:\` and `\\nas\share`). */
export function normalisePath(path: string): string {
  const trimmed = path.trim();
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed) || trimmed === '/' || trimmed === '\\') return trimmed;
  return trimmed.replace(/[\\/]+$/, '');
}
