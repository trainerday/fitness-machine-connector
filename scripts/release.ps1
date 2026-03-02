#
# Release script - bumps version, commits, tags, and pushes to trigger CI build.
#
# Usage:
#   .\scripts\release.ps1         # patch release (1.0.0 -> 1.0.1)
#   .\scripts\release.ps1 minor   # minor release (1.0.1 -> 1.1.0)
#   .\scripts\release.ps1 major   # major release (1.1.0 -> 2.0.0)
#

param(
    [ValidateSet("patch", "minor", "major")]
    [string]$VersionType = "patch"
)

$ErrorActionPreference = "Stop"

# Ensure we're on master with clean working tree
$branch = git branch --show-current
if ($branch -ne "master") {
    Write-Error "Must be on master branch (currently on $branch)"
    exit 1
}

$status = git status --porcelain
if ($status) {
    Write-Error "Working tree is not clean. Commit or stash changes first."
    exit 1
}

# Pull latest
git pull origin master
if ($LASTEXITCODE -ne 0) { exit 1 }

# Bump version (creates commit + tag automatically)
$newVersion = npm version $VersionType --message "release v%s"
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Bumped to $newVersion" -ForegroundColor Green

# Push commit and tag
git push origin master
if ($LASTEXITCODE -ne 0) { exit 1 }

git push origin $newVersion
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Release $newVersion pushed! GitHub Actions will now build and publish." -ForegroundColor Green
Write-Host "Track progress at: https://github.com/trainerday/fitness-machine-connector/actions" -ForegroundColor Cyan
