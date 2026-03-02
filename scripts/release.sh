#!/bin/bash
#
# Release script - bumps version, commits, tags, and pushes to trigger CI build.
#
# Usage:
#   ./scripts/release.sh         # patch release (1.0.0 -> 1.0.1)
#   ./scripts/release.sh minor   # minor release (1.0.1 -> 1.1.0)
#   ./scripts/release.sh major   # major release (1.1.0 -> 2.0.0)
#

set -e

VERSION_TYPE=${1:-patch}

# Validate input
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 [patch|minor|major]"
  echo "  patch - bug fixes (default)"
  echo "  minor - new features"
  echo "  major - breaking changes"
  exit 1
fi

# Ensure we're on master with clean working tree
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "master" ]; then
  echo "Error: Must be on master branch (currently on $BRANCH)"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Pull latest
git pull origin master

# Bump version (creates commit + tag automatically)
NEW_VERSION=$(npm version $VERSION_TYPE --message "release v%s")
echo "Bumped to $NEW_VERSION"

# Push commit and tag
git push origin master
git push origin "$NEW_VERSION"

echo ""
echo "Release $NEW_VERSION pushed! GitHub Actions will now build and publish."
echo "Track progress at: https://github.com/trainerday/fitness-machine-connector/actions"
