[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$commitMessage = 'feat: investor outreach engine + action system complete'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $repoRoot
try {
    & git rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Current directory is not a Git repository.'
    }

    Write-Host '== Git status before staging =='
    & git status --short --branch
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to read git status.'
    }

    Write-Host ''
    Write-Host '== Staging all tracked and untracked changes =='
    & git add --all
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to stage changes with git add --all.'
    }

    & git diff --cached --quiet --exit-code
    $hasStagedChanges = ($LASTEXITCODE -ne 0)

    if ($hasStagedChanges) {
        Write-Host ''
        Write-Host "== Creating commit: $commitMessage =="
        & git commit -m $commitMessage
        if ($LASTEXITCODE -ne 0) {
            throw 'git commit failed.'
        }
    }
    else {
        Write-Host ''
        Write-Host '== Nothing to commit after staging. Skipping commit =='
    }

    Write-Host ''
    Write-Host '== Pushing to origin main =='
    & git push origin main
    if ($LASTEXITCODE -ne 0) {
        throw 'git push origin main failed.'
    }

    Write-Host ''
    Write-Host '== Git status after push =='
    & git status --short --branch
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to read final git status.'
    }
}
finally {
    Pop-Location
}
