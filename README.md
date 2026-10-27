# Repo Harbor (github-clone)

Clone every repository from a GitHub **organisation or user** into its own folder on a **NAS or local disk**, then keep them all up to date by stashing local changes and pulling `main`/`master` across every repo at once.

**Use it here: https://adrianeyre.github.io/github-clone/**

![Repo Harbor: the page header, with the Clone and Update tabs](docs/images/desktop-hero-dark.png)

- **Organisations and users:** public repos for anyone; add a token to include private ones.
- **NAS or local storage:** UNC paths (`\\nas\share`), mapped drives, `/Volumes/…` and `/mnt/…` all work.
- **Windows, macOS and Linux:** generates PowerShell (5.1+) or Bash (3.2+) scripts.
- **Nothing to install:** only needs `git`. You can read the script before you run it.

---

## Contents

- [Quick start](#quick-start)
- [Clone an organisation or user](#clone-an-organisation-or-user)
- [Update existing clones](#update-existing-clones)
- [Using a NAS](#using-a-nas)
- [Private repositories](#private-repositories)
- [What the scripts do (and don't do)](#what-the-scripts-do-and-dont-do)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)
- [Accessibility](#accessibility)
- [Development](#development)
- [Releases and deployment](#releases-and-deployment)

## Quick start

1. Open **https://adrianeyre.github.io/github-clone/**.
2. On **Clone repositories**, type an organisation or username (or paste a GitHub link) and press **Find repositories**.
3. Choose **Local storage** or **NAS or network share**, the computer you'll run it on, and a destination folder.
4. Press **Download script**, then run it:

   ```powershell
   # Windows
   powershell -ExecutionPolicy Bypass -File .\clone-<owner>.ps1
   ```

   ```bash
   # macOS / Linux
   bash clone-<owner>.sh
   ```

Later, use the **Update existing clones** tab to bring everything up to date.

> **Why a script?** Browsers aren't allowed to run git or write to your disks and network shares. So Repo Harbor does what a web page can: it finds the repositories with GitHub's API and writes a ready-to-run script. The script runs on your computer, and your code never passes through anyone else's.

## Clone an organisation or user

Repo Harbor works out whether the name belongs to an organisation or a user, and lists every repository, across as many pages as GitHub returns. You can filter by name, include or exclude **forks** and **archived** repositories, and tick exactly the ones you want.

![Step 1 found 79 repositories for a user; step 2 lists them with checkboxes, a name filter and fork and archive toggles](docs/images/desktop-repositories-dark.png)

Pick where they go and choose **HTTPS** or **SSH**. The script appears as you go, ready to copy or download:

![Step 4: the generated PowerShell clone script for a NAS destination, with Copy and Download buttons](docs/images/desktop-clone-script-dark.png)

Each repository is cloned into its own sub-folder:

```text
\\nas\code\acme\
├── api\
├── web\
└── docs\
```

Running the script again is safe. Repositories that are already cloned are skipped, so it only adds new ones.

## Update existing clones

Point the **Update existing clones** tab at the folder that holds your clones. For **every** git repository in its sub-folders, the script:

1. fetches from `origin`;
2. stashes any local changes, including untracked files unless you turn that off;
3. checks out `main`, or `master` if there's no `main`;
4. fast-forwards it to match `origin`. It never makes merge commits;
5. optionally switches back to the branch you were on and re-applies your stash.

![The Update tab in light mode: NAS storage, macOS / Linux, and a /Volumes path](docs/images/desktop-update-light.png)

Stashes are labelled so you can find them:

```text
$ git stash list
stash@{0}: On feature/login: repo-harbor auto-stash 2026-10-27 09:15 (was on feature/login)
```

At the end you get a summary:

```text
[1/3] api
  Stashed local changes
  main is up to date

[2/3] legacy
  master is up to date

[3/3] web
  Local main has commits that are not on origin - left as is

Done. Updated: 2 of 3  Stashed: 1  Problems: 1
Local changes are stashed in (recover with "git stash pop"):
  - api
Needs attention:
  - web (main has diverged from origin)
```

Repositories in the middle of a merge, rebase, cherry-pick or revert are **skipped untouched**. The update script is a good fit for a scheduled task or cron job.

## Using a NAS

| You run it on | Example destination |
| --- | --- |
| Windows | `\\nas\share\code\acme` (UNC path) or `Z:\code\acme` (mapped drive) |
| macOS | `/Volumes/share/code/acme` (connect in Finder first) |
| Linux | `/mnt/nas/code/acme` (wherever the share is mounted) |

When **NAS or network share** is selected, the scripts run git with `-c safe.directory=*`. Network shares often report a different owner for files, and without this git refuses to work with them ("detected dubious ownership"). The setting only applies to the script's own git commands and doesn't change your git config.

The page warns you if a path doesn't suit your choices, for example a `C:\` path with the Bash script, or `C:` chosen as a NAS location.

## Private repositories

- **Listing them:** open **Include private repositories** and add a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with read-only **Metadata** access to the organisation or account. A token also raises GitHub's API limit from 60 to 5,000 requests an hour. It's held only in the page's memory and sent only to `api.github.com`. It's never saved, and never written into a script.
- **Cloning them:** git on your computer needs to be signed in to GitHub. Git for Windows (Git Credential Manager) and GitHub Desktop handle this for HTTPS. Elsewhere, run `gh auth login`, or choose **SSH** if you have an SSH key on GitHub.

## What the scripts do (and don't do)

| They do | They never |
| --- | --- |
| create the destination folder | delete files or folders |
| `git clone` into empty or new sub-folders | overwrite a non-empty folder |
| `git fetch --prune`, `git stash push`, `git checkout`, `git merge --ff-only` | force-push, reset or rebase |
| print progress and a summary, and exit with code 1 if anything needs attention | send anything anywhere except to the git remotes |

PowerShell scripts download with a UTF-8 byte-order mark, so Windows PowerShell 5.1 reads folder names with accents correctly.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `running scripts is disabled on this system` | Run with `powershell -ExecutionPolicy Bypass -File .\script.ps1`, as the page shows. |
| `git was not found on your PATH` | Install [Git](https://git-scm.com/downloads) and open a new terminal. |
| `detected dubious ownership` | Choose **NAS or network share** so the script trusts the share. |
| `Authentication failed` / `Repository not found` on clone | Sign git in to GitHub (see [Private repositories](#private-repositories)) or switch to SSH. |
| `Please tell me who you are` when stashing | Set your identity: `git config --global user.name "Your Name"` and `user.email`. |
| GitHub's API rate limit reached | Wait for the time shown, or add a token. |
| `Local main has commits that are not on origin` | That repo's `main` has diverged. Push or reset it yourself, as the script won't. |

## Privacy

No analytics, no tracking, no cookies, and no server of its own. The only network requests are to GitHub's API, made straight from your browser. Your last account name, folders and options (never a token) are saved in local storage so they're filled in next time, and you can clear them from the **Cookie Policy** in the footer. The footer links to the full Privacy Policy, Terms and Conditions, Cookie Policy and Accessibility statement, each in a dialog. The version number opens the Changelog.

## Accessibility

Built to meet **WCAG 2.2 Level AA**, in light and dark mode, and down to a 320px-wide phone:

<p>
  <img src="docs/images/phone-hero-light.png" alt="Repo Harbor on a phone in light mode" width="260" />
  &nbsp;
  <img src="docs/images/phone-repositories-light.png" alt="The repository picker on a phone" width="260" />
</p>

- **Keyboard:** everything works without a mouse, including the tabs (arrow keys, Home, End). A skip link comes first, and focus is always visible and never hidden by the sticky header.
- **Screen readers:** labelled landmarks, headings in order, a visible label on every field, and errors, results, copying and downloading announced through live regions.
- **Contrast:** at least 4.5:1 for text and 3:1 for controls and focus outlines, in both themes. `src/contrast.test.ts` checks every colour pairing on every test run, and an axe-core audit of the page reports no violations.
- **Reflow and targets:** no sideways scrolling at 320px or 400% zoom, with targets of at least 24×24px (44px for main controls).
- **Preferences:** follows the device's light or dark setting, reduced motion and Windows Contrast Themes.
- **Dialogs:** policies and the Changelog use native modal dialogs that trap focus, close on Escape and return focus to whatever opened them.

![The Accessibility statement open in a dialog](docs/images/desktop-accessibility-dialog-dark.png)

## Development

Needs Node 22 or later and git. PowerShell 7 (`pwsh`) is optional, for the PowerShell integration test outside Windows.

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests, WCAG contrast checks and end-to-end runs of the generated scripts
npm run build      # type-check and build to dist/
npm run preview    # serve dist/
```

The integration test (`src/scripts/scripts.integration.test.ts`) **runs the generated Bash and PowerShell scripts for real** against local git repositories, in a destination folder with a space and an apostrophe in its name. It clones a `main` repo and a `master` repo, re-runs the clone to check repos are skipped, then runs the update script on a repo that's on a feature branch with edits and untracked files, in both stash modes. Set `REPO_HARBOR_BASH` or `REPO_HARBOR_PWSH` to choose which shell to test, e.g. `REPO_HARBOR_PWSH=powershell` for Windows PowerShell 5.1.

| Path | What's there |
| --- | --- |
| `src/github.ts` | GitHub API client: tells organisations from users, paginates, and explains errors such as rate limits |
| `src/scripts/clone.ts`, `update.ts` | Script generators for PowerShell and Bash |
| `src/scripts/quote.ts` | Shell-safe quoting for paths and names |
| `src/main.ts`, `src/ui/` | The page: tabs, forms, repository picker, dialogs and saved settings |
| `src/changelog.ts` | Renders `CHANGELOG.md` in the footer's Changelog dialog |
| `src/styles.css` | Design tokens for the dark and light themes, and the styles |
| `index.html` | Markup, SEO, Open Graph and Twitter metadata, JSON-LD, and the policy text |
| `public/` | Favicons, web app manifest and the social preview image |
| `brand/` | Sources for the social image and icons (`bash brand/render.sh`) |
| `docs/images/` | Screenshots used in this README |

### SEO and social previews

The page has a description, canonical URL, `robots.txt`, `sitemap.xml`, JSON-LD (`WebApplication`), and Open Graph and Twitter card tags with a 1200×630 preview image, so links pasted into Slack, Teams, LinkedIn, X, Facebook, WhatsApp or Discord show the image and a description. The build fills in absolute URLs from `SITE_URL`, which the workflow takes from the Pages settings.

## Releases and deployment

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

1. **Gate:** typecheck, tests (including the real Bash and PowerShell runs) and build.
2. **Release** (on `main`): [semantic-release](https://semantic-release.gitbook.io/) works out the next version from [Conventional Commits](https://www.conventionalcommits.org/) (`fix:` → patch, `feat:` → minor, `feat!:` or `BREAKING CHANGE:` → major). It updates `CHANGELOG.md` and `package.json` in a `chore(release)` commit, tags `v<version>` and creates a GitHub release.
3. **Pages:** builds the tip of `main`, including that release commit, and deploys it to GitHub Pages, so the footer's version and Changelog always match the latest release.

**One-time setup:** in **Settings → Pages**, set **Source** to **GitHub Actions**. If `main` is protected, let GitHub Actions push the release commit, or give semantic-release a token that can.
