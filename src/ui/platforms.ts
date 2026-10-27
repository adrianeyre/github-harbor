import type { Os, StorageKind } from '../types';

export const OS_LABELS: Record<Os, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export type Mode = 'clone' | 'update';

/** The placeholder and hint for the destination folder, for the OS and storage chosen. */
export function pathExamples(storage: StorageKind, os: Os, mode: Mode, owner = 'my-org'): { placeholder: string; hint: string } {
  const tail = mode === 'clone' ? ' The folder is created if it doesn’t exist, with one sub-folder per repository.' : '';
  if (storage === 'nas') {
    switch (os) {
      case 'windows':
        return { placeholder: `\\\\nas\\share\\code\\${owner}`, hint: `A network path such as \\\\nas\\share\\code\\${owner}, or a mapped drive such as Z:\\code\\${owner}.${tail}` };
      case 'macos':
        return { placeholder: `/Volumes/share/code/${owner}`, hint: `Connect to the share in Finder first (Go › Connect to Server, e.g. smb://nas/share). It then appears under /Volumes, such as /Volumes/share/code/${owner}.${tail}` };
      case 'linux':
        return { placeholder: `/mnt/nas/code/${owner}`, hint: `Where the share is mounted, such as /mnt/nas/code/${owner} or /media/you/share/code/${owner}.${tail}` };
    }
  }
  switch (os) {
    case 'windows':
      return { placeholder: `C:\\Code\\${owner}`, hint: `For example C:\\Code\\${owner}, D:\\Repos\\${owner} or ~\\Code\\${owner}.${tail}` };
    case 'macos':
      return { placeholder: `~/Code/${owner}`, hint: `For example ~/Code/${owner}, or /Volumes/External/${owner} for a plugged-in drive.${tail}` };
    case 'linux':
      return { placeholder: `~/code/${owner}`, hint: `For example ~/code/${owner}, or /media/you/External/${owner} for a plugged-in drive.${tail}` };
  }
}

/** A gentle check that the path suits the OS and storage chosen. Never blocks the script. */
export function pathWarning(path: string, storage: StorageKind, os: Os): string {
  const p = path.trim();
  if (!p) return '';
  const windowsish = /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'));
  if (os !== 'windows' && windowsish) {
    return `This looks like a Windows path, but the script is for ${OS_LABELS[os]}. Choose Windows above, or use a path such as ${os === 'macos' ? '/Volumes/share/code' : '/mnt/nas/code'}.`;
  }
  if (os === 'windows' && p.startsWith('/') && !p.startsWith('//')) {
    return 'This looks like a macOS or Linux path, but the script is for Windows. Choose macOS or Linux above, or use a path such as C:\\Code.';
  }
  if (storage === 'nas' && os === 'windows' && /^[Cc]:/.test(p)) {
    return 'C: is usually this computer’s own disk. For a NAS, use its network path, such as \\\\nas\\share\\code, or its mapped drive letter.';
  }
  if (storage === 'nas' && os === 'macos' && !p.startsWith('/Volumes/')) {
    return 'On a Mac, network shares you connect to appear under /Volumes, such as /Volumes/share/code. Check this is where your share is.';
  }
  return '';
}

/** How to open a terminal where the script was saved, and the command that runs it. */
export function runSteps(os: Os, filename: string): { open: string; command: string } {
  switch (os) {
    case 'windows':
      return {
        open: 'Open PowerShell in the folder you saved it to: in File Explorer, right-click the folder and choose “Open in Terminal”.',
        command: `powershell -ExecutionPolicy Bypass -File .\\${filename}`,
      };
    case 'macos':
      return {
        open: 'Open Terminal (Applications › Utilities) and go to the folder you saved it to, for example: cd ~/Downloads',
        command: `bash ${filename}`,
      };
    case 'linux':
      return {
        open: 'Open a terminal and go to the folder you saved it to, for example: cd ~/Downloads',
        command: `bash ${filename}`,
      };
  }
}

/** What the visitor needs installed, and how to get it, for the OS chosen. */
export function gitPrerequisite(os: Os): string {
  switch (os) {
    case 'windows':
      return 'You need <a href="https://git-scm.com/download/win">Git for Windows</a>, or run <code>winget install --id Git.Git -e</code>. PowerShell is already part of Windows.';
    case 'macos':
      return 'You need git. If you haven’t used it on this Mac before, run <code>xcode-select --install</code> once (or <code>brew install git</code>). Bash is already part of macOS.';
    case 'linux':
      return 'You need git, from your package manager, for example <code>sudo apt install git</code> or <code>sudo dnf install git</code>.';
  }
}
