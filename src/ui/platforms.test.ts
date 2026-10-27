import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitPrerequisite, pathExamples, pathWarning, runSteps } from './platforms';
import {
  defaults, detectOs, loadSettings, recentPaths, rememberLocation, rememberOwner, SETTINGS_KEY, shellFor,
} from './settings';

describe('pathExamples', () => {
  it('suggests a path that suits each OS and storage', () => {
    expect(pathExamples('nas', 'windows', 'clone', 'acme').placeholder).toBe('\\\\nas\\share\\code\\acme');
    expect(pathExamples('nas', 'macos', 'clone', 'acme').placeholder).toBe('/Volumes/share/code/acme');
    expect(pathExamples('nas', 'linux', 'clone', 'acme').placeholder).toBe('/mnt/nas/code/acme');
    expect(pathExamples('local', 'windows', 'update').placeholder).toBe('C:\\Code\\my-org');
    expect(pathExamples('local', 'macos', 'update').placeholder).toBe('~/Code/my-org');
    expect(pathExamples('local', 'linux', 'update').placeholder).toBe('~/code/my-org');
  });
  it('only promises to create the folder when cloning', () => {
    expect(pathExamples('local', 'linux', 'clone').hint).toMatch(/created/);
    expect(pathExamples('local', 'linux', 'update').hint).not.toMatch(/created/);
  });
});

describe('pathWarning', () => {
  it('flags a Windows path for macOS or Linux, and the reverse', () => {
    expect(pathWarning('C:\\Code', 'local', 'macos')).toMatch(/Windows path.*macOS/);
    expect(pathWarning('\\\\nas\\share', 'nas', 'linux')).toMatch(/Windows path.*Linux/);
    expect(pathWarning('/home/me/code', 'local', 'windows')).toMatch(/macOS or Linux path/);
  });
  it('flags local-looking NAS paths', () => {
    expect(pathWarning('C:\\Code', 'nas', 'windows')).toMatch(/own disk/);
    expect(pathWarning('~/Code', 'nas', 'macos')).toMatch(/\/Volumes/);
  });
  it('accepts paths that fit', () => {
    expect(pathWarning('\\\\nas\\share\\code', 'nas', 'windows')).toBe('');
    expect(pathWarning('Z:\\code', 'nas', 'windows')).toBe('');
    expect(pathWarning('/Volumes/share/code', 'nas', 'macos')).toBe('');
    expect(pathWarning('/mnt/nas/code', 'nas', 'linux')).toBe('');
    expect(pathWarning('~/code', 'local', 'linux')).toBe('');
    expect(pathWarning('', 'nas', 'macos')).toBe('');
  });
});

describe('runSteps and gitPrerequisite', () => {
  it('gives the right command for each OS', () => {
    expect(runSteps('windows', 'clone-acme.ps1').command).toBe('powershell -ExecutionPolicy Bypass -File .\\clone-acme.ps1');
    expect(runSteps('macos', 'clone-acme.sh').command).toBe('bash clone-acme.sh');
    expect(runSteps('macos', 'x.sh').open).toMatch(/Terminal/);
    expect(runSteps('linux', 'x.sh').command).toBe('bash x.sh');
  });
  it('explains how to get git on each OS', () => {
    expect(gitPrerequisite('windows')).toMatch(/winget/);
    expect(gitPrerequisite('macos')).toMatch(/xcode-select --install/);
    expect(gitPrerequisite('linux')).toMatch(/apt install git/);
  });
  it('gives Windows PowerShell and the others Bash', () => {
    expect(shellFor('windows')).toBe('powershell');
    expect(shellFor('macos')).toBe('bash');
    expect(shellFor('linux')).toBe('bash');
  });
});

describe('detectOs', () => {
  afterEach(() => vi.unstubAllGlobals());
  const as = (platform: string, userAgent: string) => vi.stubGlobal('navigator', { platform, userAgent });

  it('recognises each OS', () => {
    as('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(detectOs()).toBe('windows');
    as('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)');
    expect(detectOs()).toBe('macos');
    as('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');
    expect(detectOs()).toBe('linux');
  });
  it('prefers User-Agent Client Hints', () => {
    vi.stubGlobal('navigator', { platform: '', userAgent: '', userAgentData: { platform: 'macOS' } });
    expect(detectOs()).toBe('macos');
  });
});

describe('loadSettings', () => {
  afterEach(() => vi.unstubAllGlobals());

  function withSaved(saved: unknown, platform = 'MacIntel') {
    vi.stubGlobal('navigator', { platform, userAgent: '' });
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify(saved) : null) });
  }

  it('moves v1.0 shell choices to an OS', () => {
    withSaved({ clone: { path: 'C:\\Code', storage: 'nas', shell: 'powershell' }, update: { path: '~/x', storage: 'local', shell: 'bash' } });
    const s = loadSettings();
    expect(s.clone).toEqual({ path: 'C:\\Code', storage: 'nas', os: 'windows' });
    expect(s.update).toEqual({ path: '~/x', storage: 'local', os: 'macos' });
  });
  it('does not turn a Bash choice made on Windows into Windows', () => {
    withSaved({ update: { path: '/mnt/x', storage: 'nas', shell: 'bash' } }, 'Win32');
    expect(loadSettings().update.os).toBe('linux');
  });
  it('falls back to defaults when storage is unavailable', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(loadSettings().clone).toEqual({ path: '', storage: 'local', os: 'linux' });
  });
});

describe('recent accounts and folders', () => {
  afterEach(() => vi.unstubAllGlobals());
  const fresh = () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    return defaults();
  };

  it('keeps the newest 5 accounts, without repeats in any case', () => {
    const s = fresh();
    for (const o of ['a', 'b', 'c', 'd', 'e', 'f']) rememberOwner(s, o);
    rememberOwner(s, 'C');
    expect(s.recentOwners).toEqual(['C', 'f', 'e', 'd', 'b']);
    rememberOwner(s, '  ');
    expect(s.recentOwners).toHaveLength(5);
  });

  it('keeps the newest 8 folders and suggests only those for the same storage and OS', () => {
    const s = fresh();
    rememberLocation(s, { path: '\\nas\code', storage: 'nas', os: 'windows' });
    rememberLocation(s, { path: '/Volumes/share/code', storage: 'nas', os: 'macos' });
    rememberLocation(s, { path: ' /mnt/nas/code ', storage: 'nas', os: 'linux' });
    rememberLocation(s, { path: '/mnt/nas/code', storage: 'nas', os: 'linux' });
    rememberLocation(s, { path: '', storage: 'local', os: 'linux' });
    expect(recentPaths(s, 'nas', 'linux')).toEqual(['/mnt/nas/code']);
    expect(recentPaths(s, 'nas', 'macos')).toEqual(['/Volumes/share/code']);
    expect(recentPaths(s, 'local', 'linux')).toEqual([]);
    for (let i = 0; i < 10; i++) rememberLocation(s, { path: `/x/${i}`, storage: 'local', os: 'linux' });
    expect(s.recentLocations).toHaveLength(8);
    expect(s.recentLocations[0].path).toBe('/x/9');
  });

  it('ignores anything malformed in storage', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({
        recentOwners: ['ok', 3, '', null],
        recentLocations: [{ path: '/a', storage: 'nas', os: 'linux' }, { path: '' }, 'junk', { path: '/b', storage: 'x', os: 'y' }],
      }),
    });
    const s = loadSettings();
    expect(s.recentOwners).toEqual(['ok']);
    expect(s.recentLocations).toEqual([
      { path: '/a', storage: 'nas', os: 'linux' },
      { path: '/b', storage: 'local', os: 'linux' },
    ]);
  });
});
