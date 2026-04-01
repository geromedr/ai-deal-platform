[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$commitMessage = 'feat: deal workspace + routing + error handling complete'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $repoRoot
try {
    Write-Host 'Checking Git repository'
    & git rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Current directory is not a Git repository.'
    }

    Write-Host 'Showing branch and status'
    & git status --short --branch
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to read git status.'
    }

    Write-Host 'Staging all changes'
    & git add --all
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to stage changes with git add --all.'
    }

    Write-Host 'Checking for staged changes'
    & git diff --cached --quiet
    $hasStagedChanges = ($LASTEXITCODE -ne 0)

    if (-not $hasStagedChanges) {
        Write-Host 'No changes to commit'
        exit 0
    }

    Write-Host 'Creating commit'
    & git commit -m $commitMessage
    if ($LASTEXITCODE -ne 0) {
        throw 'git commit failed.'
    }

    Write-Host 'Pushing to origin main'
    & git push origin main
    if ($LASTEXITCODE -ne 0) {
        throw 'git push origin main failed.'
    }

    Write-Host 'Git sync complete'
}
catch {
    Write-Host "Git sync failed: $($_.Exception.Message)"
    exit 1
}
finally {
    Pop-Location
}
