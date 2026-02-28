Release a new version of Faultier Tracker by following these steps exactly:

1. Check for uncommitted changes with `git status`. If there are any staged or unstaged changes, stage all modified/new tracked files and commit them with a descriptive message summarising what changed. Do not use Co-Authored-By. Then push the commit to `origin main`.

2. Read `package.json` to get the current version.

3. Ask the user what the new version should be. Present the three standard options as a bump from the current version (patch, minor, major) plus a free-entry option. Wait for their answer before proceeding.

4. Update the `"version"` field in `package.json` to the new version string chosen by the user.

5. Stage and commit only `package.json` with the message `Bump version to <version>` (no Co-Authored-By line needed).

6. Push the commit to `origin main`.

7. Create a git tag `v<version>` pointing at the new commit.

8. Push the tag to origin with `git push origin v<version>`. This triggers the GitHub Actions release workflow which builds and publishes the installer.

9. Confirm to the user that the tag has been pushed and that they can monitor the build at `https://github.com/ItsAshn/faultier-tracker/actions`.

Important rules:
- Never skip step 3 — always confirm the version with the user before making any changes to package.json.
- The git tag must match the version in package.json exactly (e.g. version `1.2.3` → tag `v1.2.3`). A mismatch causes electron-builder to publish assets to the wrong release.
- Do not push to any branch other than `main`.
- Do not amend existing commits or force-push.
