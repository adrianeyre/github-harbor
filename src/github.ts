import type { OwnerType, Repo } from './types';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface RepoListing {
  owner: string;
  ownerType: OwnerType;
  repos: Repo[];
  /** True when a token for this same user was supplied, so private repos are included. */
  includesPrivate: boolean;
}

interface ApiRepo {
  name: string;
  full_name: string;
  description: string | null;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  pushed_at: string | null;
  owner: { login: string };
}

type Fetch = typeof fetch;

function headers(token?: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function errorFor(res: Response, owner: string): Promise<GitHubError> {
  if (res.status === 401) {
    return new GitHubError('That token was rejected. Check it is valid and has not expired.', 401);
  }
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()},` : '';
    return new GitHubError(`GitHub's API rate limit has been reached.${when} or add a token to raise the limit.`, res.status);
  }
  if (res.status === 404) {
    return new GitHubError(`No GitHub organisation or user called "${owner}" was found.`, 404);
  }
  let detail = '';
  try {
    detail = ((await res.json()) as { message?: string }).message ?? '';
  } catch {
    /* body was not JSON */
  }
  return new GitHubError(`GitHub returned ${res.status}${detail ? `: ${detail}` : ''}.`, res.status);
}

function nextLink(res: Response): string | null {
  const link = res.headers.get('link');
  if (!link) return null;
  const match = link.split(',').find((part) => /rel="next"/.test(part));
  return match ? (match.match(/<([^>]+)>/)?.[1] ?? null) : null;
}

async function getJson<T>(url: string, owner: string, token: string | undefined, fetchImpl: Fetch, signal?: AbortSignal) {
  const res = await fetchImpl(url, { headers: headers(token), signal });
  if (!res.ok) throw await errorFor(res, owner);
  return { data: (await res.json()) as T, res };
}

async function paginate(firstUrl: string, owner: string, token: string | undefined, fetchImpl: Fetch, signal?: AbortSignal) {
  const all: ApiRepo[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const { data, res }: { data: ApiRepo[]; res: Response } = await getJson<ApiRepo[]>(url, owner, token, fetchImpl, signal);
    all.push(...data);
    url = nextLink(res);
  }
  return all;
}

function toRepo(r: ApiRepo): Repo {
  return {
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    cloneUrl: r.clone_url,
    sshUrl: r.ssh_url,
    defaultBranch: r.default_branch,
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    language: r.language,
    pushedAt: r.pushed_at,
  };
}

/** Valid GitHub login: alphanumerics and single hyphens, 1–39 chars, no leading/trailing hyphen. */
export function isValidOwner(owner: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(owner);
}

/** Accept "org", "@org" or a pasted URL like https://github.com/org. */
export function parseOwner(input: string): string {
  const trimmed = input.trim().replace(/^@/, '');
  const url = trimmed.match(/github\.com[/:]([^/\s?#]+)/i);
  return (url ? url[1] : trimmed).replace(/\.git$/, '');
}

/**
 * List every repository belonging to a GitHub organisation or user.
 *
 * - Organisations: all repos the caller can see (private ones need a token with access).
 * - Users: public repos, or all owned repos (including private) when the token belongs to that user.
 */
export async function listRepos(
  ownerInput: string,
  token?: string,
  { fetchImpl = fetch, signal }: { fetchImpl?: Fetch; signal?: AbortSignal } = {},
): Promise<RepoListing> {
  const owner = parseOwner(ownerInput);
  if (!isValidOwner(owner)) {
    throw new GitHubError('Enter a GitHub organisation or username, e.g. "vercel" or "torvalds".', 0);
  }
  const tok = token?.trim() || undefined;
  const call = fetchImpl.bind(globalThis);

  const { data: account } = await getJson<{ login: string; type: string }>(
    `${API}/users/${encodeURIComponent(owner)}`, owner, tok, call, signal,
  );
  const login = account.login;

  if (account.type === 'Organization') {
    const repos = await paginate(`${API}/orgs/${encodeURIComponent(login)}/repos?type=all&per_page=100`, login, tok, call, signal);
    return { owner: login, ownerType: 'Organization', repos: sortRepos(repos.map(toRepo)), includesPrivate: repos.some((r) => r.private) };
  }

  let self = false;
  if (tok) {
    const { data: me } = await getJson<{ login: string }>(`${API}/user`, login, tok, call, signal);
    self = me.login.toLowerCase() === login.toLowerCase();
  }
  const url = self
    ? `${API}/user/repos?affiliation=owner&visibility=all&per_page=100`
    : `${API}/users/${encodeURIComponent(login)}/repos?type=owner&per_page=100`;
  const repos = await paginate(url, login, tok, call, signal);
  return {
    owner: login,
    ownerType: 'User',
    // /user/repos can include repos owned by the user only, but filter defensively.
    repos: sortRepos(repos.filter((r) => r.owner.login.toLowerCase() === login.toLowerCase()).map(toRepo)),
    includesPrivate: self,
  };
}

function sortRepos(repos: Repo[]): Repo[] {
  return repos.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
