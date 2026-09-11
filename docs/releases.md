# Release checklist

Releases are a maintainer action after a tested change reaches `main`. This document defines the manual process; there is no automated package publication or release workflow yet. The package is currently private to npm, and the application runs locally.

## Prepare a release PR

Choose the next `0.x.y` version based on the scope. For this early project, use a patch for compatible fixes and a minor version for new capabilities or changes requiring upgrade attention. Describe breaking changes explicitly; a version number alone is not an upgrade plan.

Update `package.json`, the matching root version metadata in `package-lock.json`, and the adapter's `initialize.clientInfo.version` in `server/codex.mjs`. Prepare release notes covering the user-visible changes, fixes, known limitations, supported/tested OS and Node versions, and the exact Codex CLI version tested. Use the usual PR and CI process.

## Verify the candidate

- Install from a clean checkout with `npm ci` and run the standard checks.
- Check the local app starts with a separate test data directory. Never use a contributor's personal `.pipeline-data` as a release fixture.
- Record a live Codex smoke test when changes affect the adapter, execution or assistant. Use a synthetic local task with no external publication. This is separate from CI and uses the maintainer's explicitly selected account.
- Verify the relevant user flow: create a job, complete a stage, append and continue without repeating finished work, answer a question, and reopen saved results. For assistant changes, also apply and undo a proposal.
- For persisted-format changes, verify upgrade from a synthetic previous-version dataset, preservation of IDs/history, repeated startup and recovery from a failed write. Document any one-way migration.

Record the tested commit, environment and results in the release PR. Browser E2E runs in CI against the real UI and services with a synthetic Codex process. Live model compatibility remains a separate manual check; do not infer it from browser or fake-client tests.

## Publish

1. Merge the release PR and wait for successful CI on the resulting `main` commit.
2. Create a new `v0.x.y` tag pointing to that exact commit. Do not move or replace an existing release tag.
3. Create a GitHub Release for the tag with the prepared notes, startup instructions and upgrade/recovery notes. Mark a release as a prerelease when appropriate.
4. Check the published tag, commit and source archive. Link any follow-up issues rather than claiming known gaps are fixed.

The first release will use the same procedure. GitHub source releases do not publish a hosted service, Docker image or npm package.

## Upgrade and recovery notes

Stop the executor before copying or restoring data. Back up the **entire configured data directory**, including workspace definitions, run history, reviews and attempt working directories. The workspace JSON backup alone cannot restore session files. Keep backups outside the repository and retain the version of the application they belong to.

Before an upgrade, ensure no stage or assistant review is active and follow any version-specific migration instructions. If an upgrade fails, stop the new executor, preserve the failed-upgrade data for diagnosis, restore the pre-upgrade backup to a separate directory, and run the previous compatible release against that restored copy. Do not assume old code can read a newly migrated directory.

If a published release is defective, explain the issue in its notes and publish a corrected version. Keep existing tags stable so users can reproduce the version they installed.
