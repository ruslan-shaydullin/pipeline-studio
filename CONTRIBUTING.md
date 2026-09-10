# Contributing

Pipeline Studio is an early local-first prototype. Small, focused fixes and workflow improvements are welcome. English and Russian issues and discussions in PRs are both welcome.

## From idea to merge

1. For a bug, include reproduction steps, expected/actual behavior and relevant app, Node and Codex versions. Use a synthetic example rather than uploading your data directory.
2. For a larger feature, open an issue with the user problem, proposed behavior and acceptance criteria before implementation. A small fix or documentation correction can go straight to a PR.
3. Fork the repository if you do not have write access, then create a short-lived branch from current `main`. Use a descriptive branch name; agent-created branches use `codex/<short-description>`.
4. Keep the change focused. Open a draft PR when work benefits from early feedback, then mark it ready when the description and validation are complete.
5. Resolve review feedback and pass the required `check` CI job. A maintainer reviews the resulting behavior and squash-merges the PR. Branches in this repository are deleted automatically after merge.

`main` is the integration branch. Direct pushes, force pushes and branch deletion are blocked by the [main ruleset](.github/rulesets/main.json). The current single-maintainer setup requires a PR and passing CI, but does not require approval from a second GitHub account. See [development workflow](docs/development-workflow.md) for maintainer details.

## Setup

Use Node.js 22.13+ and `npm ci`. Run `npm run dev` for the local UI and runner. A logged-in Codex CLI is needed only for real agent runs, not for the test suite.

For application, dependency or runtime changes, run:

```sh
npm run test:runner
npm run typecheck
npm run lint
npm run build
```

Use `npx oxfmt <changed-files>` to format your changes. Preserve the lockfile and add behavior-focused tests for changes to orchestration, persistence and access profiles. The intentionally broken project in `examples/issue-lab` is a demonstration fixture; keep its source broken so a pipeline can fix a copy.

Documentation-only changes need content and link checks, not invented unit tests. Validate YAML/JSON when changing workflows or templates. CI still runs on every PR, including documentation changes, so the required status is always reported.

## What a ready PR contains

- The concrete problem and resulting behavior, plus a linked issue when one exists.
- Relevant validation, including what was not checked. UI changes should explain how the affected flow was exercised; a screenshot is useful when appearance changes.
- Regression coverage for changes to run state, continuation, storage or access. A fix should work across jobs, not only for a particular pipeline ID or prompt.
- Compatibility notes and an upgrade/recovery plan if persisted formats change.

AI-assisted contributions follow the same criteria. The contributor remains responsible for understanding the change, verifying it and removing private input or generated artifacts from the diff. Fake-client tests do not establish compatibility with a new Codex CLI version; record a separate live smoke test when that integration changes.

## Code map

- `app/`: pipeline editor, access controls and session UI.
- `lib/`: shared contracts, continuation rules and client state.
- `server/runner.mjs`: stage lifecycle, context handoff and run persistence.
- `server/codex.mjs`: Codex app-server transport.
- `server/workspace.mjs`: job storage, imports and concurrent-update handling.
- `server/advisor.mjs`: deep pipeline reviews and guarded apply/undo.
- `server/*.test.mjs`: temporary-file tests with a fake Codex client.

Read [architecture and invariants](docs/architecture.md) before changing these boundaries. [AGENTS.md](AGENTS.md) gives coding agents a short repository playbook.

Never commit `.pipeline-data`, real session transcripts, credentials, private prompts or working copies. Keep access decisions explicit in the UI and persisted with the run. An agent-generated prompt must not be able to change its access profile. A technical permission must not automatically answer a question for the user.

Release maintainers follow the [release checklist](docs/releases.md). Contributions are licensed under the project's MIT license.
