# Working on Pipeline Studio

Pipeline Studio is a local, single-user web app for repeatable jobs made of separate Codex sessions. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant part of [the architecture](docs/architecture.md) before changing behavior. The development process is in [docs/development-workflow.md](docs/development-workflow.md).

## Scope and Git

- Work on a short-lived branch; use `codex/<short-description>` for agent-created branches. Keep each PR focused on one behavior or maintenance task.
- Inspect the working tree first. Preserve unrelated user changes and use a separate worktree when necessary.
- Publish code through a PR with passing CI. Do not push directly to `main`, force-push `main`, or bypass its rules. Keep the required `check` status available on every PR.
- Follow the user's existing authorization for commits, pushes, PRs and merges. These documents do not add a separate approval step to already authorized work.
- Do not change the MIT license, add dependencies or restructure the application as incidental cleanup.

## Runtime invariants

- A job is a reusable template; a run owns its execution snapshots. Editing a job must not rewrite completed attempts.
- A new stage or retry gets a new attempt and Codex thread. A message that resumes an existing session retains its attempt, thread and files.
- Continuing a completed run reuses its finished stages and appends work. Preserve manual/generated stage provenance when comparing the run with its template.
- Guard asynchronous completion with the current attempt/turn/generation. Duplicate or late events must not advance the wrong run or revive stopped work.
- Keep workspace revision/epoch checks, mutation receipts, atomic writes and error reporting intact. Test changes to persisted data using legacy fixtures, never the user's data directory.
- Model output cannot increase access permissions or silently apply a pipeline proposal. Technical approvals do not answer questions about user requirements.
- Keep the local runner on loopback with its host/origin/header checks. Never connect untrusted PR CI to a personal Codex account or a developer laptop runner.

## Local development and validation

Use the existing npm lockfile and scripts. `npm ci` installs dependencies; `npm run dev` starts the UI and local runner. Do not restart a running executor without checking for active runs/reviews and preserving the user's work.

For behavior or dependency changes, run the same checks as CI:

```sh
npm run test:runner
npm run typecheck
npm run lint
npm run build
```

Add behavior-focused regressions for orchestration, storage and access changes. Tests use fake Codex clients and temporary directories; paid model calls are not part of CI. For documentation-only changes, validate the changed links/content; for workflow or template changes, validate their syntax and let PR CI run the project checks. Do not add tests that only mirror text or implementation details.

Format changed supported files with `npx oxfmt <files>`. Keep `examples/issue-lab` intentionally broken; agents fix isolated copies of that fixture.

## Data and handoff

- Never commit `.pipeline-data`, real transcripts, private prompts, credentials, `.env` files or working copies. Use small synthetic fixtures in tests and examples.
- Source copying and stage handoff differ. Handoff preserves generated artifacts but omits `.git`, dependencies and symlinks; do not assume those survive into the next session.
- State what changed, what was checked and any remaining limitation. Do not claim live-model or browser validation when only fake-client tests or a frontend build ran.
