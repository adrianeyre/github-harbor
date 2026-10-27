/**
 * The "is git installed?" check at the top of every script.
 *
 * It runs `git --version` rather than only looking for a `git` command, because
 * a fresh Mac has a placeholder /usr/bin/git that only opens Apple's "install
 * the command line developer tools" prompt and fails. How to install git is
 * explained for the OS the script is actually running on.
 */

export const INSTALL_GIT = {
  windows: 'Install it from https://git-scm.com/download/win (or run: winget install --id Git.Git -e), then open a new window and try again.',
  macos: 'Install it by running: xcode-select --install (or: brew install git), then try again.',
  linux: 'Install it with your package manager, for example: sudo apt install git, sudo dnf install git or sudo pacman -S git, then try again.',
} as const;

export const psGitCheck = `$gitWorks = $false
try {
  $null = & git --version 2>$null
  $gitWorks = $LASTEXITCODE -eq 0
} catch {
  # No git command at all.
}
if (-not $gitWorks) {
  # $IsMacOS and $IsLinux exist in PowerShell 7 on those systems; Windows PowerShell 5.1 has neither.
  $howTo = if ($IsMacOS) { '${INSTALL_GIT.macos}' } elseif ($IsLinux) { '${INSTALL_GIT.linux}' } else { '${INSTALL_GIT.windows}' }
  Write-Host "Git is not installed, or is not working. $howTo" -ForegroundColor Red
  exit 1
}`;

export const bashGitCheck = `if ! git --version >/dev/null 2>&1; then
  case "$(uname -s 2>/dev/null)" in
    Darwin) how='${INSTALL_GIT.macos}' ;;
    MINGW* | MSYS* | CYGWIN*) how='${INSTALL_GIT.windows}' ;;
    *) how='${INSTALL_GIT.linux}' ;;
  esac
  echo "Git is not installed, or is not working. $how" >&2
  exit 1
fi`;

/**
 * Options for clones on a NAS, which may be opened from Windows, macOS and Linux alike:
 * keep files exactly as committed (no CRLF conversion) and ignore the executable bit,
 * which network shares rarely store faithfully. Otherwise a repository cloned from one
 * OS looks "modified" from another, and the update script would stash it every time.
 */
export const NAS_CLONE_CONFIG = ['core.autocrlf=false', 'core.fileMode=false'] as const;
