import type { UpdateScriptOptions } from '../types';
import { bashGitCheck, psGitCheck } from './preflight';
import { normalisePath, psQuote, shPath } from './quote';

function stamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function updateScriptFilename(shell: UpdateScriptOptions['shell']): string {
  return `update-repos.${shell === 'powershell' ? 'ps1' : 'sh'}`;
}

/**
 * Build a script that visits every git repository directly under the destination,
 * stashes local changes, checks out main (or master) and fast-forwards it from origin.
 */
export function generateUpdateScript(opts: UpdateScriptOptions): string {
  return opts.shell === 'powershell' ? updatePowerShell(opts) : updateBash(opts);
}

function header(o: UpdateScriptOptions, comment: string): string {
  const lines = [
    'Repo Harbor - update script',
    `Generated ${stamp(o.generatedAt ?? new Date())}`,
    '',
    'For every git repository in a sub-folder of the destination below:',
    '  1. fetch from origin',
    `  2. stash local changes${o.includeUntracked ? ' (including untracked files)' : ' (tracked files only)'}, if there are any`,
    '  3. check out main - or master if the repository has no main branch',
    '  4. fast-forward it to match origin (never creates merge commits)',
    o.restoreWork
      ? '  5. switch back to the branch you were on and re-apply the stash'
      : '  Stashes are kept; recover them later with "git stash pop".',
    'Repositories in the middle of a merge or rebase are skipped untouched.',
  ];
  return lines.map((l) => (l ? `${comment} ${l}` : comment)).join('\n');
}

function updatePowerShell(o: UpdateScriptOptions): string {
  const head = header(o, '#');
  return `#Requires -Version 5.1
${head}
#
# Run with:  powershell -ExecutionPolicy Bypass -File .\\${updateScriptFilename('powershell')}

$Destination = ${psQuote(normalisePath(o.path))}
$IncludeUntracked = $${o.includeUntracked}
$RestoreWork = $${o.restoreWork}
${o.storage === 'nas'
    ? `# Network shares often report a different file owner, which makes git refuse to work
# ("detected dubious ownership"). Trust the repositories for these commands only.
$GitArgs = @('-c', 'safe.directory=*')`
    : '$GitArgs = @()'}

${psGitCheck}

$Destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
  Write-Host "Destination '$Destination' does not exist or is not reachable." -ForegroundColor Red
  exit 1
}

$repos = @(Get-ChildItem -LiteralPath $Destination -Directory -Force |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.git') } |
  Sort-Object Name)
if ($repos.Count -eq 0) {
  Write-Host "No git repositories found in sub-folders of $Destination" -ForegroundColor Yellow
  exit 0
}

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$updated = 0; $stashed = @(); $problems = @(); $i = 0
Write-Host "Updating $($repos.Count) repositories in $Destination" -ForegroundColor White

foreach ($dir in $repos) {
  $i++
  $path = $dir.FullName
  $name = $dir.Name
  Write-Host ""
  Write-Host "[$i/$($repos.Count)] $name" -ForegroundColor Cyan

  $busy = @('rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD') |
    Where-Object { Test-Path -LiteralPath (Join-Path $path ".git/$_") }
  if ($busy) {
    Write-Host '  A merge, rebase or cherry-pick is in progress - skipped' -ForegroundColor Yellow
    $problems += "$name (operation in progress)"
    continue
  }

  & git @GitArgs -C $path fetch --prune --quiet origin
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Could not fetch from origin - skipped' -ForegroundColor Red
    $problems += "$name (fetch failed)"
    continue
  }

  $branch = $null
  foreach ($candidate in 'main', 'master') {
    & git @GitArgs -C $path show-ref --verify --quiet "refs/remotes/origin/$candidate"
    if ($LASTEXITCODE -eq 0) { $branch = $candidate; break }
  }
  if (-not $branch) {
    $remoteHead = & git @GitArgs -C $path symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $remoteHead) { $branch = $remoteHead -replace '^origin/', '' }
  }
  if (-not $branch) {
    Write-Host '  No main or master branch on origin - skipped' -ForegroundColor Yellow
    $problems += "$name (no main/master branch)"
    continue
  }

  $original = & git @GitArgs -C $path symbolic-ref --quiet --short HEAD 2>$null
  if ($LASTEXITCODE -ne 0) { $original = $null }

  $statusArgs = @('status', '--porcelain')
  if (-not $IncludeUntracked) { $statusArgs += '--untracked-files=no' }
  $dirty = & git @GitArgs -C $path @statusArgs
  $didStash = $false
  if ($dirty) {
    $stashArgs = @('stash', 'push', '--message', "repo-harbor auto-stash $stamp (was on $(if ($original) { $original } else { 'detached HEAD' }))")
    if ($IncludeUntracked) { $stashArgs += '--include-untracked' }
    & git @GitArgs -C $path @stashArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host '  Could not stash local changes - skipped' -ForegroundColor Red
      $problems += "$name (stash failed)"
      continue
    }
    $didStash = $true
    Write-Host '  Stashed local changes' -ForegroundColor Magenta
  }

  if ($original -ne $branch) {
    & git @GitArgs -C $path checkout --quiet $branch
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  Could not check out $branch" -ForegroundColor Red
      $problems += "$name (checkout $branch failed)"
      if ($didStash) { $stashed += $name }
      continue
    }
  }

  & git @GitArgs -C $path merge --ff-only --quiet "origin/$branch"
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  $branch is up to date" -ForegroundColor Green
    $updated++
  } else {
    Write-Host "  Local $branch has commits that are not on origin - left as is" -ForegroundColor Yellow
    $problems += "$name ($branch has diverged from origin)"
  }

  if ($RestoreWork -and $original -and $original -ne $branch) {
    & git @GitArgs -C $path checkout --quiet $original
    if ($LASTEXITCODE -ne 0) { $problems += "$name (could not return to $original)" }
  }
  if ($didStash) {
    if ($RestoreWork) {
      & git @GitArgs -C $path stash pop --quiet
      if ($LASTEXITCODE -eq 0) {
        Write-Host '  Re-applied your stashed changes' -ForegroundColor Magenta
      } else {
        Write-Host '  Stash did not re-apply cleanly - it is still saved in "git stash list"' -ForegroundColor Yellow
        $problems += "$name (stash conflict)"
        $stashed += $name
      }
    } else {
      $stashed += $name
    }
  }
}

Write-Host ""
Write-Host "Done. Updated: $updated of $($repos.Count)  Stashed: $($stashed.Count)  Problems: $($problems.Count)" -ForegroundColor White
if ($stashed.Count -gt 0) {
  Write-Host 'Local changes are stashed in (recover with "git stash pop"):' -ForegroundColor Magenta
  $stashed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Magenta }
}
if ($problems.Count -gt 0) {
  Write-Host 'Needs attention:' -ForegroundColor Yellow
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
  exit 1
}
`;
}

function updateBash(o: UpdateScriptOptions): string {
  const head = header(o, '#');
  return `#!/usr/bin/env bash
${head}
#
# Run with:  bash ${updateScriptFilename('bash')}

DEST=${shPath(normalisePath(o.path))}
INCLUDE_UNTRACKED=${o.includeUntracked ? 1 : 0}
RESTORE_WORK=${o.restoreWork ? 1 : 0}
${o.storage === 'nas'
    ? `# Network shares often report a different file owner, which makes git refuse to work
# ("detected dubious ownership"). Trust the repositories for these commands only.
GIT=(git -c 'safe.directory=*')`
    : 'GIT=(git)'}

${bashGitCheck}

if [ ! -d "$DEST" ]; then
  echo "Destination '$DEST' does not exist or is not reachable." >&2
  exit 1
fi

repos=()
for dir in "$DEST"/*/ "$DEST"/.[!.]*/; do
  [ -e "$dir.git" ] && repos+=("\${dir%/}")
done
total=\${#repos[@]}
if [ "$total" -eq 0 ]; then
  echo "No git repositories found in sub-folders of $DEST"
  exit 0
fi

stamp=$(date '+%Y-%m-%d %H:%M')
updated=0; i=0
stashed=(); problems=()
echo "Updating $total repositories in $DEST"

for path in "\${repos[@]}"; do
  i=$((i + 1))
  name=\${path##*/}
  printf '\\n[%d/%d] %s\\n' "$i" "$total" "$name"

  busy=0
  for marker in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
    [ -e "$path/.git/$marker" ] && busy=1
  done
  if [ "$busy" -eq 1 ]; then
    echo "  A merge, rebase or cherry-pick is in progress - skipped"
    problems+=("$name (operation in progress)")
    continue
  fi

  if ! "\${GIT[@]}" -C "$path" fetch --prune --quiet origin; then
    echo "  Could not fetch from origin - skipped"
    problems+=("$name (fetch failed)")
    continue
  fi

  branch=""
  for candidate in main master; do
    if "\${GIT[@]}" -C "$path" show-ref --verify --quiet "refs/remotes/origin/$candidate"; then
      branch=$candidate
      break
    fi
  done
  if [ -z "$branch" ]; then
    remote_head=$("\${GIT[@]}" -C "$path" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) && branch=\${remote_head#origin/}
  fi
  if [ -z "$branch" ]; then
    echo "  No main or master branch on origin - skipped"
    problems+=("$name (no main/master branch)")
    continue
  fi

  original=$("\${GIT[@]}" -C "$path" symbolic-ref --quiet --short HEAD 2>/dev/null) || original=""

  if [ "$INCLUDE_UNTRACKED" -eq 1 ]; then
    dirty=$("\${GIT[@]}" -C "$path" status --porcelain)
  else
    dirty=$("\${GIT[@]}" -C "$path" status --porcelain --untracked-files=no)
  fi
  did_stash=0
  if [ -n "$dirty" ]; then
    stash_args=(stash push --message "repo-harbor auto-stash $stamp (was on \${original:-detached HEAD})")
    [ "$INCLUDE_UNTRACKED" -eq 1 ] && stash_args+=(--include-untracked)
    if ! "\${GIT[@]}" -C "$path" "\${stash_args[@]}" >/dev/null; then
      echo "  Could not stash local changes - skipped"
      problems+=("$name (stash failed)")
      continue
    fi
    did_stash=1
    echo "  Stashed local changes"
  fi

  if [ "$original" != "$branch" ]; then
    if ! "\${GIT[@]}" -C "$path" checkout --quiet "$branch"; then
      echo "  Could not check out $branch"
      problems+=("$name (checkout $branch failed)")
      [ "$did_stash" -eq 1 ] && stashed+=("$name")
      continue
    fi
  fi

  if "\${GIT[@]}" -C "$path" merge --ff-only --quiet "origin/$branch"; then
    echo "  $branch is up to date"
    updated=$((updated + 1))
  else
    echo "  Local $branch has commits that are not on origin - left as is"
    problems+=("$name ($branch has diverged from origin)")
  fi

  if [ "$RESTORE_WORK" -eq 1 ] && [ -n "$original" ] && [ "$original" != "$branch" ]; then
    "\${GIT[@]}" -C "$path" checkout --quiet "$original" || problems+=("$name (could not return to $original)")
  fi
  if [ "$did_stash" -eq 1 ]; then
    if [ "$RESTORE_WORK" -eq 1 ]; then
      if "\${GIT[@]}" -C "$path" stash pop --quiet; then
        echo "  Re-applied your stashed changes"
      else
        echo "  Stash did not re-apply cleanly - it is still saved in \\"git stash list\\""
        problems+=("$name (stash conflict)")
        stashed+=("$name")
      fi
    else
      stashed+=("$name")
    fi
  fi
done

printf '\\nDone. Updated: %d of %d  Stashed: %d  Problems: %d\\n' "$updated" "$total" "\${#stashed[@]}" "\${#problems[@]}"
if [ "\${#stashed[@]}" -gt 0 ]; then
  echo 'Local changes are stashed in (recover with "git stash pop"):'
  for s in "\${stashed[@]}"; do echo "  - $s"; done
fi
if [ "\${#problems[@]}" -gt 0 ]; then
  echo "Needs attention:"
  for p in "\${problems[@]}"; do echo "  - $p"; done
  exit 1
fi
`;
}
