# Development workflow

Pipeline Studio uses a single integration branch and small pull requests:

**Issue when needed → branch → draft/ready PR → CI and review → squash merge → release when ready.**

## Choose and implement a change

For a substantial feature, agree on the user problem, acceptance criteria and scope in an issue before writing code. Use issues for reproducible bugs; a small fix can go directly to a PR. Keep features that can ship independently in separate PRs.

Start from current `main`. Contributors without write access work from a fork. Agent-created branches use `codex/<short-description>`; other contributors can choose a descriptive name. There is no permanent `develop` branch or mandatory issue-number naming scheme.

Use the issue and PR templates to record enough information for another person to reproduce and review the change. Avoid putting personal jobs, model transcripts or credentials in public examples. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for local checks and [AGENTS.md](../AGENTS.md) for agent work.

## CI and review

The required GitHub Actions job is **`check`** in [ci.yml](../.github/workflows/ci.yml). It installs the lockfile, runs the test suite, checks TypeScript, runs lint, builds the frontend and exercises Chromium user scenarios on Ubuntu with Node 22. It runs for every PR and pushes to `main`. Superseded runs for the same PR or branch are cancelled.

CI uses synthetic data and fake Codex clients. Browser E2E runs real local services and JSONL transport against a deterministic executor in temporary directories. It does not call a paid model, load a developer's Codex login or execute on a contributor's laptop. Failure traces and synthetic service logs are retained for seven days. Live Codex compatibility is checked separately and recorded in the release notes.

Before merge, a maintainer examines the final diff, scope, compatibility notes and validation. Resolve actionable review conversations. For changes to the executor, check the [runtime invariants](architecture.md#invariants). Bring an outdated branch up to date and wait for checks on the updated result.

The current single-maintainer setup has **zero required approving reviews**. This permits the maintainer to merge their own reviewed PR; passing CI and a PR are still mandatory. If a second active maintainer joins, reconsider requiring one independent approval.

## Repository settings

The active `main` ruleset:

- Requires a PR and the successful `check` status from the GitHub Actions app (integration ID `15368`).
- Requires the PR to be up to date with its base and review conversations to be resolved.
- Prevents deletion and force pushes, and requires linear history.
- Allows squash merging and has no bypass actors.

The repository enables squash merge, disables merge/rebase merge methods and deletes merged branches automatically. These are GitHub settings; adding a configuration file to Git does not activate them automatically.

[.github/rulesets/main.json](../.github/rulesets/main.json) is the versioned definition of the ruleset. Repository administrators manage its live copy. Before an update, inspect the current rules and preserve any unrelated settings:

```sh
gh api repos/ruslan-shaydullin/pipeline-studio/rulesets
gh api repos/ruslan-shaydullin/pipeline-studio/rules/branches/main
```

For a ruleset change, review the JSON in a PR, then update the existing ruleset by its returned ID with the GitHub API or settings UI. Read the live rule back afterward. Do not create duplicate rulesets or rename `check` without coordinating the required status. GitHub documents [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) and their [REST API](https://docs.github.com/en/rest/repos/rules).

If CI is broken, fix it through a branch and PR. An administrator can edit a mistaken rule configuration, but removing protection is not the normal path for a failed test or an urgent feature.

## Merge and follow through

Use a concise PR title that describes the resulting behavior; it becomes the squash commit title. The PR body carries the context and validation. Conventional Commit prefixes are optional.

After merge, check the `main` CI result. Close a related issue only when its acceptance criteria are fulfilled. Follow [the release checklist](releases.md) when publishing a version; every merge does not need a release.

## Next improvements

Track these as separate changes rather than treating the current checks as coverage they do not provide:

1. Browser coverage for multiple tabs, dynamic stage creation and additional browser engines.
2. Versioned transport contract fixtures for a broader range of supported Codex CLI versions.
3. Repeatable upgrade fixtures when the first persisted-format migration is introduced.

Keep the workflow small enough that a contributor can make one focused improvement without learning a separate process framework.
