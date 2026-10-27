import type { CloneScriptOptions } from '../types';
import { bashGitCheck, NAS_CLONE_CONFIG, psGitCheck } from './preflight';
import { normalisePath, psQuote, shPath, shQuote } from './quote';

function stamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function urlFor(repo: CloneScriptOptions['repos'][number], protocol: CloneScriptOptions['protocol']): string {
  return protocol === 'ssh' ? repo.sshUrl : repo.cloneUrl;
}

export function cloneScriptFilename(opts: Pick<CloneScriptOptions, 'owner' | 'shell'>): string {
  return `clone-${opts.owner.toLowerCase()}.${opts.shell === 'powershell' ? 'ps1' : 'sh'}`;
}

/** Build a script that clones each selected repo into `<destination>/<repo-name>`. */
export function generateCloneScript(opts: CloneScriptOptions): string {
  return opts.shell === 'powershell' ? clonePowerShell(opts) : cloneBash(opts);
}

function clonePowerShell(o: CloneScriptOptions): string {
  const dest = normalisePath(o.path);
  const kind = o.ownerType === 'Organization' ? 'organisation' : 'user';
  const repoLines = o.repos.map((r) => `  @{ Name = ${psQuote(r.name)}; Url = ${psQuote(urlFor(r, o.protocol))} }`);
  return `#Requires -Version 5.1
<#
  Repo Harbor - clone script
  Generated ${stamp(o.generatedAt ?? new Date())}

  Clones ${o.repos.length} repositor${o.repos.length === 1 ? 'y' : 'ies'} from the GitHub ${kind} '${o.owner.replace(/'/g, '')}'
  into one sub-folder per repository under the destination below.
  Repositories that are already cloned are skipped, so it is safe to run again.

  Run with:  powershell -ExecutionPolicy Bypass -File .\\${cloneScriptFilename(o)}
#>

$Destination = ${psQuote(dest)}
$Repos = @(
${repoLines.join('\n')}
)
${o.storage === 'nas'
    ? `# Network shares often report a different file owner, which makes git refuse to work
# ("detected dubious ownership"). Trust the repositories for these commands only.
$GitArgs = @('-c', 'safe.directory=*')
# A NAS may be used from Windows, macOS and Linux: keep files exactly as committed and
# ignore the executable bit, so a clone made on one never looks modified on another.
$CloneArgs = @(${NAS_CLONE_CONFIG.map((c) => `'--config', '${c}'`).join(', ')})`
    : `$GitArgs = @()
$CloneArgs = @()`}

${psGitCheck}

$Destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
try {
  New-Item -ItemType Directory -Force -Path $Destination -ErrorAction Stop | Out-Null
} catch {
  Write-Host "Could not create or open '$Destination': $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "Cloning $($Repos.Count) repositories into $Destination" -ForegroundColor White
$cloned = 0; $skipped = 0; $failed = @(); $i = 0
foreach ($repo in $Repos) {
  $i++
  $target = Join-Path $Destination $repo.Name
  Write-Host ""
  Write-Host "[$i/$($Repos.Count)] $($repo.Name)" -ForegroundColor Cyan
  if (Test-Path -LiteralPath (Join-Path $target '.git')) {
    Write-Host '  Already cloned - skipped' -ForegroundColor DarkGray
    $skipped++
    continue
  }
  if ((Test-Path -LiteralPath $target) -and (Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1)) {
    Write-Host '  Folder exists and is not empty - skipped' -ForegroundColor Yellow
    $failed += "$($repo.Name) (folder not empty)"
    continue
  }
  & git @GitArgs clone --quiet @CloneArgs -- $repo.Url $target
  if ($LASTEXITCODE -eq 0) {
    Write-Host '  Cloned' -ForegroundColor Green
    $cloned++
  } else {
    Write-Host '  Clone failed' -ForegroundColor Red
    $failed += "$($repo.Name) (git clone failed)"
  }
}

Write-Host ""
Write-Host "Done. Cloned: $cloned  Skipped: $skipped  Problems: $($failed.Count)" -ForegroundColor White
if ($failed.Count -gt 0) {
  Write-Host 'Needs attention:' -ForegroundColor Yellow
  $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
  exit 1
}
`;
}

function cloneBash(o: CloneScriptOptions): string {
  const dest = normalisePath(o.path);
  const kind = o.ownerType === 'Organization' ? 'organisation' : 'user';
  const repoLines = o.repos.map((r) => `  ${shQuote(`${r.name}|${urlFor(r, o.protocol)}`)}`);
  return `#!/usr/bin/env bash
# Repo Harbor - clone script
# Generated ${stamp(o.generatedAt ?? new Date())}
#
# Clones ${o.repos.length} repositor${o.repos.length === 1 ? 'y' : 'ies'} from the GitHub ${kind} '${o.owner.replace(/'/g, '')}'
# into one sub-folder per repository under the destination below.
# Repositories that are already cloned are skipped, so it is safe to run again.
#
# Run with:  bash ${cloneScriptFilename(o)}

DEST=${shPath(dest)}
REPOS=(
${repoLines.join('\n')}
)
${o.storage === 'nas'
    ? `# Network shares often report a different file owner, which makes git refuse to work
# ("detected dubious ownership"). Trust the repositories for these commands only.
GIT=(git -c 'safe.directory=*')
# A NAS may be used from Windows, macOS and Linux: keep files exactly as committed and
# ignore the executable bit, so a clone made on one never looks modified on another.
CLONE_OPTS=(${NAS_CLONE_CONFIG.map((c) => `--config ${c}`).join(' ')})`
    : `GIT=(git)
CLONE_OPTS=()`}

${bashGitCheck}

if ! mkdir -p -- "$DEST"; then
  echo "Could not create or open '$DEST'." >&2
  exit 1
fi

total=\${#REPOS[@]}
echo "Cloning $total repositories into $DEST"
cloned=0; skipped=0; i=0
failed=()
for entry in "\${REPOS[@]}"; do
  i=$((i + 1))
  name=\${entry%%|*}
  url=\${entry#*|}
  target="$DEST/$name"
  printf '\\n[%d/%d] %s\\n' "$i" "$total" "$name"
  if [ -e "$target/.git" ]; then
    echo "  Already cloned - skipped"
    skipped=$((skipped + 1))
    continue
  fi
  if [ -d "$target" ] && [ -n "$(ls -A -- "$target" 2>/dev/null)" ]; then
    echo "  Folder exists and is not empty - skipped"
    failed+=("$name (folder not empty)")
    continue
  fi
  if "\${GIT[@]}" clone --quiet "\${CLONE_OPTS[@]}" -- "$url" "$target"; then
    echo "  Cloned"
    cloned=$((cloned + 1))
  else
    echo "  Clone failed"
    failed+=("$name (git clone failed)")
  fi
done

printf '\\nDone. Cloned: %d  Skipped: %d  Problems: %d\\n' "$cloned" "$skipped" "\${#failed[@]}"
if [ "\${#failed[@]}" -gt 0 ]; then
  echo "Needs attention:"
  for f in "\${failed[@]}"; do echo "  - $f"; done
  exit 1
fi
`;
}
