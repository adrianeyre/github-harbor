export type Shell = 'powershell' | 'bash';
export type StorageKind = 'local' | 'nas';
export type Protocol = 'https' | 'ssh';
export type OwnerType = 'Organization' | 'User';

export interface Repo {
  name: string;
  fullName: string;
  description: string | null;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  pushedAt: string | null;
}

export interface Destination {
  path: string;
  storage: StorageKind;
  shell: Shell;
}

export interface CloneScriptOptions extends Destination {
  owner: string;
  ownerType: OwnerType;
  protocol: Protocol;
  repos: Pick<Repo, 'name' | 'cloneUrl' | 'sshUrl'>[];
  /** Fixed timestamp for reproducible output in tests. */
  generatedAt?: Date;
}

export interface UpdateScriptOptions extends Destination {
  /** Stash untracked (new) files as well as modified tracked files. */
  includeUntracked: boolean;
  /** After updating main/master, switch back to the branch you were on and re-apply your stash. */
  restoreWork: boolean;
  generatedAt?: Date;
}
