#!/bin/bash
# Helper script to update AUR package after version bump
# Run this after the GitHub release is complete
# NOTE: This is now automated via .github/workflows/aur.yml

set -e

# Get current version from PKGBUILD
pkgver=$(grep '^pkgver=' PKGBUILD | cut -d'=' -f2)

echo "Updating AUR package for version $pkgver..."
echo ""

# Check if the release exists on GitHub
echo "Checking GitHub release..."
if ! curl -s -o /dev/null -w "%{http_code}" "https://github.com/ItsAshn/Kioku/releases/download/v$pkgver/kioku-$pkgver.pacman" | grep -q "200"; then
    echo "ERROR: Release v$pkgver not found on GitHub yet!"
    echo "Please wait for the GitHub Actions build to complete."
    exit 1
fi

echo "Release found! Updating package..."
echo ""

# Update checksums
echo "Updating checksums..."
updpkgsums

# Generate .SRCINFO
echo "Generating .SRCINFO..."
makepkg --printsrcinfo > .SRCINFO

echo ""
echo "✓ AUR package updated locally!"
echo ""
echo "NOTE: AUR updates are now automated via GitHub Actions."
echo "This script is kept for local testing purposes only."
echo ""
echo "To push manually (if automation fails):"
echo "  git clone ssh://aur@aur.archlinux.org/kioku.git /tmp/aur-kioku"
echo "  cp PKGBUILD .SRCINFO /tmp/aur-kioku/"
echo "  cd /tmp/aur-kioku"
echo "  git add PKGBUILD .SRCINFO"
echo "  git commit -m \"Update to $pkgver\""
echo "  git push origin master"