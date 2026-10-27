/**
 * Runs the generated scripts for real, in each shell that is installed, against
 * local bare repositories standing in for GitHub. The destination has a space
 * and an apostrophe in it, to prove the quoting.
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateCloneScript } from './clone';
import { generateUpdateScript } from './update';
import type { Shell } from '../types';

const env: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
};

const isWindows = process.platform === 'win32';
/** Forward slashes work for git and for both shells on every platform. */
const slash = (p: string) => p.replace(/\\/g, '/');

function works(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
}

// On Windows, plain `bash` may be WSL's, which cannot see Windows paths, so prefer Git's own.
const gitBash = 'C:/Program Files/Git/bin/bash.exe';
const bash = process.env.REPO_HARBOR_BASH || (isWindows && existsSync(gitBash) ? gitBash : 'bash');
const pwsh = process.env.REPO_HARBOR_PWSH || 'pwsh';

type Run = (file: string, extraPath?: string) => SpawnSyncReturns<string>;

/** `env` with a folder put first on PATH (Windows spells it "Path"). */
function withPathFirst(dir: string | undefined): NodeJS.ProcessEnv {
  if (!dir) return env;
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...env, [key]: `${dir}${delimiter}${env[key] ?? ''}` };
}

const powershell = (cmd: string): Run => (file, extraPath) =>
  spawnSync(cmd, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { env: withPathFirst(extraPath), encoding: 'utf8' });

/** Every shell the scripts are written for that is installed here: CI runs this on Windows, macOS and Linux. */
const shells: { name: string; shell: Shell; run: Run; available: boolean }[] = [
  {
    name: 'bash',
    shell: 'bash',
    available: works(bash, ['-c', 'exit 0']),
    run: (file, extraPath) => spawnSync(bash, [file], { env: withPathFirst(extraPath), encoding: 'utf8' }),
  },
  { name: 'PowerShell 7', shell: 'powershell', available: works(pwsh, ['-NoProfile', '-Command', 'exit 0']), run: powershell(pwsh) },
  // Windows PowerShell 5.1, which every Windows PC has even without PowerShell 7.
  {
    name: 'Windows PowerShell 5.1',
    shell: 'powershell',
    available: isWindows && !process.env.REPO_HARBOR_PWSH && works('powershell', ['-NoProfile', '-Command', 'exit 0']),
    run: powershell('powershell'),
  },
];

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'repo-harbor-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A bare "remote" with one commit on `branch`, plus a working copy used to push more. */
function makeRemote(base: string, name: string, branch: string) {
  const bare = join(base, 'remotes', `${name}.git`);
  const seed = join(base, 'seeds', name);
  mkdirSync(seed, { recursive: true });
  git(base, 'init', '--quiet', '--bare', `--initial-branch=${branch}`, bare);
  git(base, 'init', '--quiet', `--initial-branch=${branch}`, seed);
  writeFileSync(join(seed, 'README.md'), `# ${name}\n`);
  git(seed, 'add', '.');
  git(seed, 'commit', '--quiet', '-m', 'initial');
  git(seed, 'remote', 'add', 'origin', slash(bare));
  git(seed, 'push', '--quiet', 'origin', branch);
  const push = (file: string, text: string) => {
    writeFileSync(join(seed, file), text);
    git(seed, 'add', '.');
    git(seed, 'commit', '--quiet', '-m', `add ${file}`);
    git(seed, 'push', '--quiet', 'origin', branch);
    return git(seed, 'rev-parse', 'HEAD');
  };
  return { url: slash(bare), push };
}

describe.each(shells)('$name scripts', ({ name, shell, available, run }) => {
  it.skipIf(!available)('clone every repo into its own folder, then stash, switch and fast-forward on update', () => {
    const base = join(root, name.replace(/\W+/g, '-'));
    const dest = join(base, "my org's code");
    const api = makeRemote(base, 'api', 'main');
    const legacy = makeRemote(base, 'legacy', 'master');
    const ext = shell === 'powershell' ? 'ps1' : 'sh';

    // --- clone ---
    const cloneFile = join(base, `clone.${ext}`);
    writeFileSync(cloneFile, generateCloneScript({
      owner: 'acme', ownerType: 'Organization', protocol: 'https', storage: 'nas', shell,
      path: slash(dest) + '/',
      repos: [
        { name: 'api', cloneUrl: api.url, sshUrl: api.url },
        { name: 'legacy', cloneUrl: legacy.url, sshUrl: legacy.url },
      ],
    }));
    let result = run(cloneFile);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(join(dest, 'api', 'README.md'), 'utf8')).toBe('# api\n');
    expect(readFileSync(join(dest, 'legacy', 'README.md'), 'utf8')).toBe('# legacy\n');
    // NAS clones keep files as committed and ignore the executable bit, so they read the same from every OS.
    expect(git(join(dest, 'api'), 'config', '--local', 'core.autocrlf')).toBe('false');
    expect(git(join(dest, 'api'), 'config', '--local', 'core.fileMode')).toBe('false');

    // Running again skips what is already there.
    result = run(cloneFile);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Skipped: 2');

    // --- update, keeping stashes ---
    const apiPath = join(dest, 'api');
    git(apiPath, 'checkout', '--quiet', '-b', 'feature');
    writeFileSync(join(apiPath, 'README.md'), 'local edit\n');
    writeFileSync(join(apiPath, 'notes.txt'), 'untracked\n');
    const apiHead = api.push('one.txt', '1');
    const legacyHead = legacy.push('one.txt', '1');

    const updateFile = join(base, `update.${ext}`);
    writeFileSync(updateFile, generateUpdateScript({ path: slash(dest), storage: 'nas', shell, includeUntracked: true, restoreWork: false }));
    result = run(updateFile);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Updated: 2 of 2');
    expect(git(apiPath, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(git(apiPath, 'rev-parse', 'HEAD')).toBe(apiHead);
    expect(git(join(dest, 'legacy'), 'symbolic-ref', '--short', 'HEAD')).toBe('master');
    expect(git(join(dest, 'legacy'), 'rev-parse', 'HEAD')).toBe(legacyHead);
    expect(git(apiPath, 'status', '--porcelain')).toBe('');
    expect(git(apiPath, 'stash', 'list')).toMatch(/repo-harbor auto-stash .* \(was on feature\)/);

    // --- update, returning to the branch and restoring work ---
    git(apiPath, 'checkout', '--quiet', 'feature');
    git(apiPath, 'stash', 'pop', '--quiet');
    const apiHead2 = api.push('two.txt', '2');
    writeFileSync(updateFile, generateUpdateScript({ path: slash(dest), storage: 'local', shell, includeUntracked: true, restoreWork: true }));
    result = run(updateFile);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(git(apiPath, 'symbolic-ref', '--short', 'HEAD')).toBe('feature');
    expect(git(apiPath, 'rev-parse', 'main')).toBe(apiHead2);
    expect(readFileSync(join(apiPath, 'README.md'), 'utf8')).toBe('local edit\n');
    expect(existsSync(join(apiPath, 'notes.txt'))).toBe(true);
    expect(git(apiPath, 'stash', 'list')).toBe('');
  });

  // Like the placeholder /usr/bin/git on a Mac without the developer tools: a `git` command that only fails.
  // Skipped for Git Bash on Windows, whose launcher puts its own git first on PATH.
  it.skipIf(!available || (isWindows && shell === 'bash'))('stops with install instructions when git does not work', () => {
    const base = join(root, `${name.replace(/\W+/g, '-')}-no-git`);
    const fakeBin = join(base, 'bin');
    mkdirSync(fakeBin, { recursive: true });
    if (isWindows) {
      writeFileSync(join(fakeBin, 'git.cmd'), '@echo xcrun: error: invalid active developer path 1>&2\r\n@exit /b 1\r\n');
    } else {
      writeFileSync(join(fakeBin, 'git'), '#!/bin/sh\necho "xcrun: error: invalid active developer path" >&2\nexit 1\n');
      chmodSync(join(fakeBin, 'git'), 0o755);
    }
    const dest = join(base, 'dest');
    const file = join(base, `clone.${shell === 'powershell' ? 'ps1' : 'sh'}`);
    writeFileSync(file, generateCloneScript({
      owner: 'acme', ownerType: 'Organization', protocol: 'https', storage: 'local', shell, path: slash(dest),
      repos: [{ name: 'api', cloneUrl: 'https://example.invalid/api.git', sshUrl: '' }],
    }));
    const result = run(file, fakeBin);
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).toBe(1);
    expect(output).toContain('Git is not installed, or is not working.');
    const howTo: Record<string, string> = { win32: 'winget install', darwin: 'xcode-select --install' };
    expect(output).toContain(howTo[process.platform] ?? 'apt install git');
    expect(existsSync(dest)).toBe(false);
  });
});
