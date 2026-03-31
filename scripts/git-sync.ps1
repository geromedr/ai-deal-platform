[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$commitMessage = 'chore: sync latest system state'
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
    Write-Host '== Staging all changes =='
    & git add --all
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to stage changes with git add --all.'
    }

    Write-Host ''
    Write-Host '== Checking for staged changes =='
    & git diff --cached --quiet
    $hasStagedChanges = ($LASTEXITCODE -ne 0)

    if (-not $hasStagedChanges) {
        Write-Host 'No changes to commit'
        exit 0
    }

    Write-Host ''
    Write-Host "== Creating commit: $commitMessage =="
    & git commit -m $commitMessage
    if ($LASTEXITCODE -ne 0) {
        throw 'git commit failed.'
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
catch {
    Write-Host ''
    Write-Host "Git sync failed: $($_.Exception.Message)"
    exit 1
}
finally {
    Pop-Location
}
