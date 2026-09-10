# Contributing

Pipeline Studio is an early local-first prototype. Small, focused fixes and workflow improvements are welcome. For larger changes, open an issue describing the problem and expected behavior before starting.

## Setup

Use Node.js 22.13+ and `npm ci`. Run `npm run dev` for the local UI and runner. A logged-in Codex CLI is needed only for real agent runs, not for the test suite.

Before submitting a pull request:

```sh
npm run test:runner
npm run typecheck
npm run lint
npm run build
```

Use `npx oxfmt <changed-files>` to format your changes. Preserve the lockfile and add behavior-focused tests for changes to orchestration, persistence and access profiles. The intentionally broken project in `examples/issue-lab` is a demonstration fixture; keep its source broken so a pipeline can fix a copy.

## Code map

- `app/`: pipeline editor, access controls and session UI.
- `lib/`: shared contracts, continuation rules and client state.
- `server/runner.mjs`: stage lifecycle, context handoff and run persistence.
- `server/codex.mjs`: Codex app-server transport.
- `server/workspace.mjs`: job storage, imports and concurrent-update handling.
- `server/*.test.mjs`: temporary-file tests with a fake Codex client.

Never commit `.pipeline-data`, real session transcripts, credentials, private prompts or working copies. Keep access decisions explicit in the UI and persisted with the run. An agent-generated prompt must not be able to change its access profile. A technical permission must not automatically answer a question for the user.

PR descriptions should explain the behavior change and the checks you ran. Contributions are licensed under the project's MIT license.
