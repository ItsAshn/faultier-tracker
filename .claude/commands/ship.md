Release a new version of Faultier Tracker by following these steps exactly:

1. Read `package.json` to get the current version.

2. Ask the user what the new version should be. Present the three standard options as a bump from the current version (patch, minor, major) plus a free-entry option. Wait for their answer before proceeding.

3. Update the `"version"` field in `package.json` to the new version string chosen by the user.

4. Stage and commit only `package.json` with the message `Bump version to <version>` (no Co-Authored-By line needed).

5. Push the commit to `origin main`.

6. Create a git tag `v<version>` pointing at the new commit.

7. Push the tag to origin with `git push origin v<version>`. This triggers the GitHub Actions release workflow which builds and publishes the installer.

8. Confirm to the user that the tag has been pushed and that they can monitor the build at `https://github.com/ItsAshn/faultier-tracker/actions`.

Important rules:
- Never skip step 2 — always confirm the version with the user before making any changes.
- The git tag must match the version in package.json exactly (e.g. version `1.2.3` → tag `v1.2.3`). A mismatch causes electron-builder to publish assets to the wrong release.
- Do not push to any branch other than `main`.
- Do not amend existing commits or force-push.
