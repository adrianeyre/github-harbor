import { describe, expect, it, vi } from 'vitest';
import { GitHubError, isValidOwner, listRepos, parseOwner } from './github';

function repo(name: string, owner = 'acme', extra: Record<string, unknown> = {}) {
  return {
    name,
    full_name: `${owner}/${name}`,
    description: null,
    clone_url: `https://github.com/${owner}/${name}.git`,
    ssh_url: `git@github.com:${owner}/${name}.git`,
    default_branch: 'main',
    private: false,
    fork: false,
    archived: false,
    language: 'TypeScript',
    pushed_at: null,
    owner: { login: owner },
    ...extra,
  };
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });
}

function router(routes: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request) => {
    const key = String(url).replace('https://api.github.com', '');
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('parseOwner / isValidOwner', () => {
  it('accepts names, @names and GitHub URLs', () => {
    expect(parseOwner(' @acme ')).toBe('acme');
    expect(parseOwner('https://github.com/acme-co/some-repo')).toBe('acme-co');
    expect(parseOwner('git@github.com:acme/x.git')).toBe('acme');
  });
  it('validates GitHub login rules', () => {
    expect(isValidOwner('acme-co')).toBe(true);
    expect(isValidOwner('-acme')).toBe(false);
    expect(isValidOwner('a--b')).toBe(false);
    expect(isValidOwner('a'.repeat(40))).toBe(false);
  });
});

describe('listRepos', () => {
  it('lists every page of an organisation, sorted by name', async () => {
    const fetchImpl = router({
      '/users/acme': () => json({ login: 'Acme', type: 'Organization' }),
      '/orgs/Acme/repos?type=all&per_page=100': () =>
        json([repo('zeta'), repo('Alpha')], {
          headers: { link: '<https://api.github.com/orgs/Acme/repos?type=all&per_page=100&page=2>; rel="next", <x>; rel="last"' },
        }),
      '/orgs/Acme/repos?type=all&per_page=100&page=2': () => json([repo('mid', 'acme', { private: true })]),
    });
    const result = await listRepos('acme', undefined, { fetchImpl });
    expect(result.ownerType).toBe('Organization');
    expect(result.owner).toBe('Acme');
    expect(result.repos.map((r) => r.name)).toEqual(['Alpha', 'mid', 'zeta']);
    expect(result.includesPrivate).toBe(true);
  });

  it("lists a user's public repos when no token is given", async () => {
    const fetchImpl = router({
      '/users/octo': () => json({ login: 'octo', type: 'User' }),
      '/users/octo/repos?type=owner&per_page=100': () => json([repo('dotfiles', 'octo')]),
    });
    const result = await listRepos('octo', undefined, { fetchImpl });
    expect(result.ownerType).toBe('User');
    expect(result.repos.map((r) => r.name)).toEqual(['dotfiles']);
    expect(result.includesPrivate).toBe(false);
  });

  it("includes a user's private repos when the token belongs to them", async () => {
    const fetchImpl = router({
      '/users/octo': () => json({ login: 'octo', type: 'User' }),
      '/user': () => json({ login: 'Octo' }),
      '/user/repos?affiliation=owner&visibility=all&per_page=100': () =>
        json([repo('secret', 'octo', { private: true }), repo('other-owner', 'someone-else')]),
    });
    const result = await listRepos('octo', 'tok', { fetchImpl });
    expect(result.includesPrivate).toBe(true);
    expect(result.repos.map((r) => r.name)).toEqual(['secret']);
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('explains a missing owner', async () => {
    const fetchImpl = router({ '/users/nobody': () => json({ message: 'Not Found' }, { status: 404 }) });
    await expect(listRepos('nobody', undefined, { fetchImpl })).rejects.toThrow(/No GitHub organisation or user called "nobody"/);
  });

  it('explains rate limiting', async () => {
    const fetchImpl = router({
      '/users/acme': () => json({ message: 'rate limited' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    });
    await expect(listRepos('acme', undefined, { fetchImpl })).rejects.toThrow(/rate limit/);
  });

  it('rejects invalid names without calling the API', async () => {
    const fetchImpl = router({});
    await expect(listRepos('not a name', undefined, { fetchImpl })).rejects.toBeInstanceOf(GitHubError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
