import type { Os, Protocol, Shell, StorageKind } from '../types';

/** The local storage key, as the Cookie Policy lists it. */
export const SETTINGS_KEY = 'repo-harbor:settings';

export interface DestinationSettings {
  path: string;
  storage: StorageKind;
  os: Os;
}

/** A folder a script was actually made for, remembered so it can be picked again. */
export interface RecentLocation {
  path: string;
  storage: StorageKind;
  os: Os;
}

export const MAX_RECENT_OWNERS = 5;
export const MAX_RECENT_LOCATIONS = 8;

export interface Settings {
  owner: string;
  /** Accounts looked up successfully, newest first. */
  recentOwners: string[];
  /** Folders scripts were copied or downloaded for, newest first. */
  recentLocations: RecentLocation[];
  protocol: Protocol;
  includeForks: boolean;
  includeArchived: boolean;
  includeUntracked: boolean;
  restoreWork: boolean;
  clone: DestinationSettings;
  update: DestinationSettings;
}

export const shellFor = (os: Os): Shell => (os === 'windows' ? 'powershell' : 'bash');

/** The visitor's OS, as the default for "Computer you'll run the script on". */
export function detectOs(): Os {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent}`;
  // Mac first: "Darwin" would otherwise match "win".
  if (/mac|iphone|ipad|ipod/i.test(platform)) return 'macos';
  if (/win/i.test(platform)) return 'windows';
  return 'linux';
}

export function defaults(): Settings {
  const os = detectOs();
  return {
    owner: '',
    recentOwners: [],
    recentLocations: [],
    protocol: 'https',
    includeForks: true,
    includeArchived: false,
    includeUntracked: true,
    restoreWork: false,
    clone: { path: '', storage: 'local', os },
    update: { path: '', storage: 'local', os },
  };
}

const OSES: readonly Os[] = ['windows', 'macos', 'linux'];

/** A saved destination, including one saved by v1.0, which stored a shell rather than an OS. */
function destination(saved: unknown, base: DestinationSettings): DestinationSettings {
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<DestinationSettings> & { shell?: Shell };
  let os = OSES.includes(s.os as Os) ? (s.os as Os) : base.os;
  if (!s.os && s.shell) os = s.shell === 'powershell' ? 'windows' : base.os === 'windows' ? 'linux' : base.os;
  return {
    path: typeof s.path === 'string' ? s.path : base.path,
    storage: s.storage === 'nas' ? 'nas' : 'local',
    os,
  };
}

/** Saved settings over the defaults. Storage can be missing or blocked, so every access is guarded. */
export function loadSettings(): Settings {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    if (!saved || typeof saved !== 'object') return base;
    return {
      ...base,
      ...saved,
      recentOwners: Array.isArray(saved.recentOwners)
        ? saved.recentOwners.filter((o): o is string => typeof o === 'string' && o !== '').slice(0, MAX_RECENT_OWNERS)
        : [],
      recentLocations: Array.isArray(saved.recentLocations)
        ? saved.recentLocations
            .map((l) => destination(l, { path: '', storage: 'local', os: base.clone.os }))
            .filter((l) => l.path.trim() !== '')
            .slice(0, MAX_RECENT_LOCATIONS)
        : [],
      clone: destination(saved.clone, base.clone),
      update: destination(saved.update, base.update),
    };
  } catch {
    return base;
  }
}

/** Put `owner` first in the recent accounts, without repeats (GitHub names ignore case). */
export function rememberOwner(settings: Settings, owner: string): void {
  const name = owner.trim();
  if (!name) return;
  settings.recentOwners = [name, ...settings.recentOwners.filter((o) => o.toLowerCase() !== name.toLowerCase())].slice(0, MAX_RECENT_OWNERS);
}

/** Put a folder first in the recent locations, without repeats. */
export function rememberLocation(settings: Settings, location: RecentLocation): void {
  const path = location.path.trim();
  if (!path) return;
  const same = (l: RecentLocation) => l.path === path && l.storage === location.storage && l.os === location.os;
  settings.recentLocations = [{ ...location, path }, ...settings.recentLocations.filter((l) => !same(l))].slice(0, MAX_RECENT_LOCATIONS);
}

/** Recent folders that suit the storage and OS chosen, newest first. */
export function recentPaths(settings: Settings, storage: StorageKind, os: Os): string[] {
  return settings.recentLocations.filter((l) => l.storage === storage && l.os === os).map((l) => l.path);
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
