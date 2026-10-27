import { describe, expect, it } from 'vitest';
import { cloneScriptFilename, generateCloneScript } from './clone';
import { generateUpdateScript, updateScriptFilename } from './update';
import type { CloneScriptOptions, UpdateScriptOptions } from '../types';

const at = new Date('2026-01-02T03:04:05Z');
const repos = [
  { name: 'api', cloneUrl: 'https://github.com/acme/api.git', sshUrl: 'git@github.com:acme/api.git' },
  { name: 'web', cloneUrl: 'https://github.com/acme/web.git', sshUrl: 'git@github.com:acme/web.git' },
];
const clone = (o: Partial<CloneScriptOptions>): CloneScriptOptions => ({
  owner: 'acme', ownerType: 'Organization', protocol: 'https', repos, path: 'C:\\Code\\acme\\', storage: 'local', shell: 'powershell', generatedAt: at, ...o,
});
const update = (o: Partial<UpdateScriptOptions>): UpdateScriptOptions => ({
  path: '/srv/code', storage: 'local', shell: 'bash', includeUntracked: true, restoreWork: false, generatedAt: at, ...o,
});

describe('generateCloneScript', () => {
  it('writes a PowerShell repo list with the chosen protocol and normalised destination', () => {
    const ps = generateCloneScript(clone({ protocol: 'ssh' }));
    expect(ps).toContain(`$Destination = 'C:\\Code\\acme'`);
    expect(ps).toContain(`@{ Name = 'api'; Url = 'git@github.com:acme/api.git' }`);
    expect(ps).toContain('$GitArgs = @()');
    expect(ps).toContain('Generated 2026-01-02 03:04:05 UTC');
  });

  it('trusts repositories on a NAS so git does not refuse them', () => {
    expect(generateCloneScript(clone({ storage: 'nas' }))).toContain(`$GitArgs = @('-c', 'safe.directory=*')`);
    expect(generateCloneScript(clone({ storage: 'nas', shell: 'bash' }))).toContain(`GIT=(git -c 'safe.directory=*')`);
  });

  it('writes a bash repo list that expands ~', () => {
    const sh = generateCloneScript(clone({ shell: 'bash', path: '~/code/acme' }));
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(sh).toContain(`DEST="$HOME"'/code/acme'`);
    expect(sh).toContain(`'web|https://github.com/acme/web.git'`);
  });

  it('describes users as users', () => {
    expect(generateCloneScript(clone({ ownerType: 'User' }))).toContain("GitHub user 'acme'");
  });

  it('names files after the owner and shell', () => {
    expect(cloneScriptFilename({ owner: 'Acme', shell: 'powershell' })).toBe('clone-acme.ps1');
    expect(cloneScriptFilename({ owner: 'acme', shell: 'bash' })).toBe('clone-acme.sh');
  });
});

describe('generateUpdateScript', () => {
  it('reflects the stash options in both shells', () => {
    const sh = generateUpdateScript(update({ includeUntracked: false, restoreWork: true }));
    expect(sh).toContain('INCLUDE_UNTRACKED=0');
    expect(sh).toContain('RESTORE_WORK=1');
    expect(sh).toContain('stash push');
    const ps = generateUpdateScript(update({ shell: 'powershell' }));
    expect(ps).toContain('$IncludeUntracked = $true');
    expect(ps).toContain('$RestoreWork = $false');
  });

  it('prefers main, then master', () => {
    const ps = generateUpdateScript(update({ shell: 'powershell' }));
    expect(ps).toContain(`foreach ($candidate in 'main', 'master')`);
    expect(generateUpdateScript(update({}))).toContain('for candidate in main master; do');
  });

  it('names files by shell', () => {
    expect(updateScriptFilename('powershell')).toBe('update-repos.ps1');
    expect(updateScriptFilename('bash')).toBe('update-repos.sh');
  });
});
