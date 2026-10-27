import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles.css';

import changelog from '../CHANGELOG.md?raw';
import { renderChangelog } from './changelog';
import { GitHubError, listRepos, type RepoListing } from './github';
import { cloneScriptFilename, generateCloneScript } from './scripts/clone';
import { generateUpdateScript, updateScriptFilename } from './scripts/update';
import type { Protocol, Repo, Shell, StorageKind } from './types';
import { makeDialog, type Dialog } from './ui/dialog';
import { $, announce, escapeHtml, icon } from './ui/dom';
import { clearSettings, loadSettings, saveSettings } from './ui/settings';

type Mode = 'clone' | 'update';

const settings = loadSettings();
const save = () => saveSettings(settings);

/* ---------- Tabs ---------- */

const tabs = [$<HTMLButtonElement>('#tab-clone'), $<HTMLButtonElement>('#tab-update')];

function selectTab(mode: Mode, { focus = false, updateUrl = true } = {}): void {
  for (const tab of tabs) {
    const selected = tab.id === `tab-${mode}`;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
    if (selected && focus) tab.focus();
  }
  if (updateUrl) history.replaceState(null, '', mode === 'update' ? '#update' : location.pathname + location.search);
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab.id === 'tab-update' ? 'update' : 'clone'));
  tab.addEventListener('keydown', (event) => {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = tabs[(keys[event.key] + tabs.length) % tabs.length];
    selectTab(next.id === 'tab-update' ? 'update' : 'clone', { focus: true });
  });
});

/* ---------- Destination fields (shared by both tabs) ---------- */

interface DestinationUi {
  path: HTMLInputElement;
  hint: HTMLElement;
  warning: HTMLElement;
}

const destinations = {} as Record<Mode, DestinationUi>;

function pathExamples(storage: StorageKind, shell: Shell, mode: Mode): { placeholder: string; hint: string } {
  const owner = mode === 'clone' ? settings.owner.trim() || 'my-org' : 'my-org';
  const tail = mode === 'clone' ? ' The folder is created if it doesn’t exist, with one sub-folder per repository.' : '';
  if (storage === 'nas') {
    return shell === 'powershell'
      ? { placeholder: `\\\\nas\\share\\code\\${owner}`, hint: `A network path such as \\\\nas\\share\\code\\${owner}, or a mapped drive such as Z:\\code\\${owner}.${tail}` }
      : { placeholder: `/Volumes/share/code/${owner}`, hint: `Where the share is mounted, such as /Volumes/share/code/${owner} on macOS or /mnt/nas/code/${owner} on Linux.${tail}` };
  }
  return shell === 'powershell'
    ? { placeholder: `C:\\Code\\${owner}`, hint: `For example C:\\Code\\${owner}, D:\\Repos\\${owner} or ~\\Code\\${owner}.${tail}` }
    : { placeholder: `~/code/${owner}`, hint: `For example ~/code/${owner} or /Users/me/code/${owner}.${tail}` };
}

/** A gentle check that the path suits the shell and storage chosen. Never blocks the script. */
function pathWarning(path: string, storage: StorageKind, shell: Shell): string {
  const p = path.trim();
  if (!p) return '';
  const windowsish = /^[A-Za-z]:([\\/]|$)/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'));
  if (shell === 'bash' && windowsish) {
    return 'This looks like a Windows path, but the script is for macOS or Linux. Choose Windows (PowerShell) above, or use a path such as /mnt/nas/code.';
  }
  if (shell === 'powershell' && p.startsWith('/') && !p.startsWith('//')) {
    return 'This looks like a macOS or Linux path, but the script is for Windows. Choose macOS / Linux (Bash) above, or use a path such as C:\\Code.';
  }
  if (storage === 'nas' && shell === 'powershell' && /^[Cc]:/.test(p)) {
    return 'C: is usually this computer’s own disk. For a NAS, use its network path, such as \\\\nas\\share\\code, or its mapped drive letter.';
  }
  return '';
}

function renderDestination(mode: Mode): void {
  const host = $(`[data-destination="${mode}"]`);
  const s = settings[mode];
  const k = mode;
  host.innerHTML = `
    <fieldset class="field">
      <legend>Storage</legend>
      <div class="choice-cards">
        <label class="choice">
          <input type="radio" name="${k}-storage" value="local" ${s.storage === 'local' ? 'checked' : ''} />
          ${icon('hard-drive', 'icon choice-icon')}
          <span><span class="choice-title">Local storage</span><span class="choice-sub">This computer or a drive plugged into it</span></span>
        </label>
        <label class="choice">
          <input type="radio" name="${k}-storage" value="nas" ${s.storage === 'nas' ? 'checked' : ''} />
          ${icon('server', 'icon choice-icon')}
          <span><span class="choice-title">NAS or network share</span><span class="choice-sub">A shared folder on a NAS or file server</span></span>
        </label>
      </div>
    </fieldset>
    <fieldset class="field">
      <legend>Computer you’ll run the script on</legend>
      <div class="segmented">
        <label><input type="radio" name="${k}-shell" value="powershell" ${s.shell === 'powershell' ? 'checked' : ''} /><span>Windows (PowerShell)</span></label>
        <label><input type="radio" name="${k}-shell" value="bash" ${s.shell === 'bash' ? 'checked' : ''} /><span>macOS / Linux (Bash)</span></label>
      </div>
    </fieldset>
    <div class="field">
      <label for="${k}-path">${mode === 'clone' ? 'Destination folder' : 'Folder that holds your clones'}</label>
      <p class="hint" id="${k}-path-hint"></p>
      <input id="${k}-path" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="${k}-path-hint ${k}-path-warning" />
      <p class="field-warning" id="${k}-path-warning" hidden></p>
    </div>`;
  const ui: DestinationUi = { path: $(`#${k}-path`, host), hint: $(`#${k}-path-hint`, host), warning: $(`#${k}-path-warning`, host) };
  ui.path.value = s.path;
  destinations[mode] = ui;

  host.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === `${k}-storage`) s.storage = input.value as StorageKind;
    if (input.name === `${k}-shell`) s.shell = input.value as Shell;
    save();
    refresh(mode);
  });
  ui.path.addEventListener('input', () => {
    s.path = ui.path.value;
    save();
    refresh(mode);
  });
}

function refreshDestination(mode: Mode): void {
  const s = settings[mode];
  const ui = destinations[mode];
  const { placeholder, hint } = pathExamples(s.storage, s.shell, mode);
  ui.path.placeholder = placeholder;
  ui.hint.textContent = hint;
  const warning = pathWarning(s.path, s.storage, s.shell);
  ui.warning.hidden = !warning;
  ui.warning.innerHTML = warning ? `${icon('alert')}<span>${escapeHtml(warning)}</span>` : '';
}

/* ---------- Script output (shared by both tabs) ---------- */

interface OutputUi {
  missing: HTMLElement;
  missingList: HTMLUListElement;
  ready: HTMLElement;
  filename: HTMLElement;
  code: HTMLElement;
  copy: HTMLButtonElement;
  download: HTMLButtonElement;
  openStep: HTMLElement;
  command: HTMLElement;
  copyCommand: HTMLButtonElement;
  script: string;
}

const outputs = {} as Record<Mode, OutputUi>;

function renderOutput(mode: Mode): void {
  const host = $(`[data-output="${mode}"]`);
  host.innerHTML = `
    <div class="notice notice-warning missing">
      ${icon('alert')}
      <div>
        <p>Your script will appear here once you have:</p>
        <ul></ul>
      </div>
    </div>
    <div class="ready" hidden>
      <div class="script-head">
        <p class="script-file">${icon('terminal')}<span class="filename"></span></p>
        <div class="button-group">
          <button type="button" class="button" data-action="copy">${icon('copy')}<span>Copy</span></button>
          <button type="button" class="button button-primary" data-action="download">${icon('download')}<span>Download script</span></button>
        </div>
      </div>
      <pre class="script" tabindex="0" role="region" aria-label="Script preview, scrollable"><code></code></pre>
      <div class="run">
        <h3>How to run it</h3>
        <ol>
          <li>Download the script, or copy it into a file with the name shown above.</li>
          <li class="open-step"></li>
          <li>
            Run:
            <span class="command-row"><code class="command"></code><button type="button" class="button button-small" data-action="copy-command">${icon('copy')}<span>Copy<span class="visually-hidden"> command</span></span></button></span>
          </li>
        </ol>
        <p class="hint">The script prints each repository as it goes and a summary at the end. You need <a href="https://git-scm.com/downloads">git</a> installed. Read it first if you like: it is plain text.</p>
      </div>
    </div>`;
  const ui: OutputUi = {
    missing: $('.missing', host),
    missingList: $<HTMLUListElement>('.missing ul', host),
    ready: $('.ready', host),
    filename: $('.filename', host),
    code: $('.script code', host),
    copy: $<HTMLButtonElement>('[data-action="copy"]', host),
    download: $<HTMLButtonElement>('[data-action="download"]', host),
    openStep: $('.open-step', host),
    command: $('.command', host),
    copyCommand: $<HTMLButtonElement>('[data-action="copy-command"]', host),
    script: '',
  };
  outputs[mode] = ui;

  ui.copy.addEventListener('click', () => copyText(ui.script, ui.copy, 'Script copied to the clipboard'));
  ui.copyCommand.addEventListener('click', () => copyText(ui.command.textContent ?? '', ui.copyCommand, 'Command copied to the clipboard'));
  ui.download.addEventListener('click', () => {
    const name = ui.filename.textContent ?? 'script.txt';
    const isPs = name.endsWith('.ps1');
    // Windows PowerShell 5.1 reads a .ps1 without a byte-order mark as ANSI, mangling non-English folder names.
    const text = isPs ? `\uFEFF${ui.script.replace(/\r?\n/g, '\r\n')}` : ui.script.replace(/\r\n/g, '\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce(`Downloading ${name}`);
  });
}

async function copyText(text: string, button: HTMLButtonElement, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers, or a page without clipboard permission: fall back to a hidden textarea.
    const area = Object.assign(document.createElement('textarea'), { value: text });
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const label = button.querySelector('span');
  if (label) {
    const original = label.innerHTML;
    label.textContent = 'Copied';
    button.classList.add('is-done');
    setTimeout(() => {
      label.innerHTML = original;
      button.classList.remove('is-done');
    }, 2000);
  }
  announce(message);
}

function showOutput(mode: Mode, missing: string[], make: () => { script: string; filename: string; shell: Shell }): void {
  const ui = outputs[mode];
  ui.missing.hidden = missing.length === 0;
  ui.ready.hidden = missing.length > 0;
  ui.missingList.innerHTML = missing.map((m) => `<li>${m}</li>`).join('');
  if (missing.length > 0) {
    ui.script = '';
    return;
  }
  const { script, filename, shell } = make();
  ui.script = script;
  ui.filename.textContent = filename;
  ui.code.textContent = script;
  ui.openStep.textContent =
    shell === 'powershell'
      ? 'Open PowerShell in the folder you saved it to (in File Explorer, hold Shift, right-click the folder and choose “Open PowerShell window here” or “Open in Terminal”).'
      : 'Open Terminal and go to the folder you saved it to, for example cd ~/Downloads.';
  ui.command.textContent = shell === 'powershell' ? `powershell -ExecutionPolicy Bypass -File .\\${filename}` : `bash ${filename}`;
}

/* ---------- Clone: account and repositories ---------- */

let listing: RepoListing | null = null;
const selected = new Set<string>();
let request: AbortController | null = null;

const ownerForm = $<HTMLFormElement>('#owner-form');
const ownerInput = $<HTMLInputElement>('#owner');
const ownerError = $('#owner-error');
const ownerStatus = $('#owner-status');
const ownerSubmit = $<HTMLButtonElement>('#owner-submit');
const tokenInput = $<HTMLInputElement>('#token');
const repoList = $<HTMLUListElement>('#repo-list');
const repoFilter = $<HTMLInputElement>('#repo-filter');
const includeForks = $<HTMLInputElement>('#include-forks');
const includeArchived = $<HTMLInputElement>('#include-archived');
const repoCount = $('#repo-count');

function setOwnerError(message: string): void {
  ownerError.hidden = !message;
  ownerError.innerHTML = message ? `${icon('alert')}<span>${escapeHtml(message)}</span>` : '';
  if (message) ownerInput.setAttribute('aria-invalid', 'true');
  else ownerInput.removeAttribute('aria-invalid');
}

const isEligible = (repo: Repo) => (settings.includeForks || !repo.fork) && (settings.includeArchived || !repo.archived);

function chosenRepos(): Repo[] {
  return listing ? listing.repos.filter((r) => isEligible(r) && selected.has(r.name)) : [];
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function updatedAgo(iso: string | null): string {
  if (!iso) return '';
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (Math.abs(days) < 1) return 'Updated today';
  if (Math.abs(days) < 30) return `Updated ${relativeTime.format(days, 'day')}`;
  if (Math.abs(days) < 365) return `Updated ${relativeTime.format(Math.round(days / 30), 'month')}`;
  return `Updated ${relativeTime.format(Math.round(days / 365), 'year')}`;
}

function renderRepos(): void {
  if (!listing) return;
  const fragment = document.createDocumentFragment();
  for (const repo of listing.repos) {
    const li = document.createElement('li');
    li.className = 'repo';
    li.dataset.name = repo.name.toLowerCase();
    const badges = [
      repo.private ? `<span class="badge">${icon('lock')}Private</span>` : '',
      repo.fork ? '<span class="badge">Fork</span>' : '',
      repo.archived ? '<span class="badge badge-warning">Archived</span>' : '',
    ].join('');
    const meta = [repo.language, updatedAgo(repo.pushedAt)].filter(Boolean).map((m) => `<span>${escapeHtml(m!)}</span>`).join('');
    li.innerHTML = `
      <label class="repo-row">
        <input type="checkbox" value="${escapeHtml(repo.name)}" ${selected.has(repo.name) ? 'checked' : ''} />
        <span class="repo-main">
          <span class="repo-name">${escapeHtml(repo.name)}${badges}</span>
          ${repo.description ? `<span class="repo-desc">${escapeHtml(repo.description)}</span>` : ''}
        </span>
        <span class="repo-meta">${meta}</span>
      </label>`;
    fragment.append(li);
  }
  repoList.replaceChildren(fragment);
  applyRepoFilter();
}

function applyRepoFilter(): void {
  if (!listing) return;
  const query = repoFilter.value.trim().toLowerCase();
  const byName = new Map(listing.repos.map((r) => [r.name.toLowerCase(), r]));
  let shown = 0;
  for (const li of repoList.children as HTMLCollectionOf<HTMLLIElement>) {
    const repo = byName.get(li.dataset.name!)!;
    const visible = isEligible(repo) && (!query || li.dataset.name!.includes(query));
    li.hidden = !visible;
    if (visible) shown++;
  }
  updateCount(shown);
}

function updateCount(shown?: number): void {
  if (!listing) return;
  const eligible = listing.repos.filter(isEligible).length;
  const chosen = chosenRepos().length;
  shown ??= [...repoList.children].filter((li) => !(li as HTMLElement).hidden).length;
  repoCount.textContent = `${chosen} of ${eligible} repositor${eligible === 1 ? 'y' : 'ies'} selected${shown < eligible ? `, ${shown} shown` : ''}`;
}

function visibleCheckboxes(): HTMLInputElement[] {
  return [...repoList.querySelectorAll<HTMLInputElement>('li:not([hidden]) input[type="checkbox"]')];
}

ownerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const owner = ownerInput.value.trim();
  if (!owner) {
    setOwnerError('Enter the name of a GitHub organisation or user.');
    ownerInput.focus();
    return;
  }
  setOwnerError('');
  request?.abort();
  request = new AbortController();
  const submitIcon = ownerSubmit.querySelector('use')!;
  ownerSubmit.setAttribute('aria-disabled', 'true');
  ownerSubmit.classList.add('is-loading');
  submitIcon.setAttribute('href', '#i-loader');
  ownerStatus.textContent = `Looking up ${owner} on GitHub…`;
  try {
    const result = await listRepos(owner, tokenInput.value, { signal: request.signal });
    listing = result;
    settings.owner = result.owner;
    ownerInput.value = result.owner;
    save();
    selected.clear();
    for (const repo of result.repos) if (isEligible(repo)) selected.add(repo.name);
    const kind = result.ownerType === 'Organization' ? 'organisation' : 'user';
    const privateNote = result.includesPrivate ? ', including private ones' : tokenInput.value ? '' : '. Add a token to include private ones';
    ownerStatus.innerHTML = `${icon('check')}<span>Found ${result.repos.length} repositor${result.repos.length === 1 ? 'y' : 'ies'} for the ${kind} <strong>${escapeHtml(result.owner)}</strong>${privateNote}.</span>`;
    $('#repos-empty').hidden = result.repos.length > 0;
    if (result.repos.length === 0) $('#repos-empty p').textContent = `${result.owner} has no repositories you can see.`;
    $('#repos-ui').hidden = result.repos.length === 0;
    renderRepos();
    refresh('clone');
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    ownerStatus.textContent = '';
    setOwnerError(error instanceof GitHubError ? error.message : 'Couldn’t reach GitHub. Check your internet connection and try again.');
    ownerInput.focus();
  } finally {
    ownerSubmit.removeAttribute('aria-disabled');
    ownerSubmit.classList.remove('is-loading');
    submitIcon.setAttribute('href', '#i-search');
  }
});

ownerInput.addEventListener('input', () => {
  if (ownerInput.getAttribute('aria-invalid')) setOwnerError('');
});

repoList.addEventListener('change', (event) => {
  const box = event.target as HTMLInputElement;
  if (box.checked) selected.add(box.value);
  else selected.delete(box.value);
  updateCount();
  refresh('clone');
});
repoFilter.addEventListener('input', applyRepoFilter);
for (const [box, key] of [[includeForks, 'includeForks'], [includeArchived, 'includeArchived']] as const) {
  box.checked = settings[key];
  box.addEventListener('change', () => {
    settings[key] = box.checked;
    save();
    applyRepoFilter();
    refresh('clone');
  });
}
$('#select-all').addEventListener('click', () => {
  for (const box of visibleCheckboxes()) {
    box.checked = true;
    selected.add(box.value);
  }
  updateCount();
  refresh('clone');
  announce(repoCount.textContent ?? '');
});
$('#select-none').addEventListener('click', () => {
  for (const box of visibleCheckboxes()) {
    box.checked = false;
    selected.delete(box.value);
  }
  updateCount();
  refresh('clone');
  announce(repoCount.textContent ?? '');
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="protocol"]')) {
  radio.checked = radio.value === settings.protocol;
  radio.addEventListener('change', () => {
    settings.protocol = radio.value as Protocol;
    save();
    refresh('clone');
  });
}

/* ---------- Update options ---------- */

for (const [id, key] of [['#include-untracked', 'includeUntracked'], ['#restore-work', 'restoreWork']] as const) {
  const box = $<HTMLInputElement>(id);
  box.checked = settings[key];
  box.addEventListener('change', () => {
    settings[key] = box.checked;
    save();
    refresh('update');
  });
}

/* ---------- Generate ---------- */

function refresh(mode: Mode): void {
  refreshDestination(mode);
  const dest = settings[mode];
  if (mode === 'clone') {
    const repos = chosenRepos();
    const missing = [
      !listing ? 'found a GitHub account’s repositories (step 1)' : '',
      listing && repos.length === 0 ? 'selected at least one repository (step 2)' : '',
      !dest.path.trim() ? 'entered a destination folder (step 3)' : '',
    ].filter(Boolean);
    showOutput('clone', missing, () => ({
      shell: dest.shell,
      filename: cloneScriptFilename({ owner: listing!.owner, shell: dest.shell }),
      script: generateCloneScript({
        owner: listing!.owner, ownerType: listing!.ownerType, protocol: settings.protocol, repos, ...dest,
      }),
    }));
  } else {
    showOutput('update', dest.path.trim() ? [] : ['entered the folder that holds your clones (step 1)'], () => ({
      shell: dest.shell,
      filename: updateScriptFilename(dest.shell),
      script: generateUpdateScript({ ...dest, includeUntracked: settings.includeUntracked, restoreWork: settings.restoreWork }),
    }));
  }
}

/* ---------- Policies and Changelog, in dialogs ---------- */

const dialogs = new Map<string, Dialog>();
for (const section of document.querySelectorAll<HTMLElement>('#policies .policy')) {
  const title = section.querySelector('h2')?.textContent ?? '';
  const dialog = makeDialog({ id: section.id, title, closeLabel: section.dataset.closeLabel ?? `Close ${title}` });
  dialog.body.append(...section.querySelector('.policy-body')!.childNodes);
  dialogs.set(section.id, dialog);
}
$('#policies').remove();

const changelogDialog = makeDialog({ id: 'changelog', title: `Changelog`, closeLabel: 'Close the changelog' });
changelogDialog.body.append(renderChangelog(changelog));
dialogs.set('changelog', changelogDialog);

document.addEventListener('click', (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-policy], a[data-changelog]');
  if (!link) return;
  event.preventDefault();
  // Safari doesn't focus a link it clicks, and the dialog hands focus back to it.
  link.focus();
  dialogs.get(link.dataset.policy ?? 'changelog')?.open();
});
document.querySelectorAll('a[data-policy], a[data-changelog]').forEach((a) => a.setAttribute('aria-haspopup', 'dialog'));

$('#forget-settings').addEventListener('click', () => {
  clearSettings();
  $('#forget-status').textContent = 'Your saved settings have been cleared.';
});

/* ---------- Start ---------- */

renderDestination('clone');
renderDestination('update');
renderOutput('clone');
renderOutput('update');

const params = new URLSearchParams(location.search);
ownerInput.value = params.get('owner') ?? params.get('org') ?? params.get('user') ?? settings.owner;

const hash = location.hash.slice(1);
selectTab(hash === 'update' ? 'update' : 'clone', { updateUrl: false });
refresh('clone');
refresh('update');
if (dialogs.has(hash)) dialogs.get(hash)!.open();
