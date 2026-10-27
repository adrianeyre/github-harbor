import type { Protocol, Shell, StorageKind } from '../types';

/** The local storage key, as the Cookie Policy lists it. */
export const SETTINGS_KEY = 'repo-harbor:settings';

export interface Settings {
  owner: string;
  protocol: Protocol;
  includeForks: boolean;
  includeArchived: boolean;
  includeUntracked: boolean;
  restoreWork: boolean;
  clone: { path: string; storage: StorageKind; shell: Shell };
  update: { path: string; storage: StorageKind; shell: Shell };
}

export function detectShell(): Shell {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
  return /win/i.test(platform) ? 'powershell' : 'bash';
}

export function defaults(): Settings {
  const shell = detectShell();
  return {
    owner: '',
    protocol: 'https',
    includeForks: true,
    includeArchived: false,
    includeUntracked: true,
    restoreWork: false,
    clone: { path: '', storage: 'local', shell },
    update: { path: '', storage: 'local', shell },
  };
}

/** Saved settings over the defaults. Storage can be missing or blocked, so every access is guarded. */
export function loadSettings(): Settings {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    if (!saved || typeof saved !== 'object') return base;
    return { ...base, ...saved, clone: { ...base.clone, ...saved.clone }, update: { ...base.update, ...saved.update } };
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable; settings just aren't remembered */
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    /* nothing to clear */
  }
}
