# Pipeline Studio user guide

English · [Русский](user-guide.ru.md) · [Back to README](../README.md)

Pipeline Studio is a local, single-user workspace for repeatable jobs made of separate Codex sessions. A **job** is a reusable template. A **run** saves its own task, stages and execution history. Each new stage or retry has a separate **attempt**, working directory and Codex session; sending a message to resume an existing attempt keeps that session and its files.

## Setup and CLI selection

Use Node.js **22.13+**, npm, Git and an authenticated [Codex CLI](https://developers.openai.com/codex/cli). The adapter has been checked with `codex-cli 0.153.4`. macOS is the primary tested platform; Linux CI covers installation, tests and build. Other platforms and CLI versions may need integration work.

```sh
git clone https://github.com/ruslan-shaydullin/pipeline-studio.git
cd pipeline-studio
npm ci
codex login
npm run dev
```

Open [localhost:3000](http://localhost:3000). `npm run dev` starts the UI at `localhost:3000` and the runner at `127.0.0.1:4317`; `npm start` is an alias for the same development setup. Ctrl+C stops both services. Closing a browser tab does not stop a run. The components can also be started separately with `npm run dev:web` and `npm run dev:runner`.

Unless `PIPELINE_CODEX_BIN` is set, the runner checks `/Applications/ChatGPT.app/Contents/Resources/codex`, then falls back to `codex` from `PATH`. Other bundled CLI locations must be selected explicitly with `PIPELINE_CODEX_BIN`. To select the executable from your terminal explicitly:

```sh
PIPELINE_CODEX_BIN="$(command -v codex)" npm run dev
```

Sign in with the same executable the runner uses. Authentication is managed by Codex CLI: the app does not copy or read OAuth tokens or put an API key in the frontend. Runs use your existing account limits. Choose the model in the launch form.

| Variable             | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `PIPELINE_CODEX_BIN` | Path to the Codex executable                                                  |
| `PIPELINE_DATA_DIR`  | Data directory; defaults to `.pipeline-data`                                  |
| `PIPELINE_PORT`      | Runner port; changing it also requires updating the proxy in `vite.config.ts` |

Keep the runner local. It accepts requests only from your computer, has no multi-user authentication and is not designed to be exposed to a network.

## Run a pipeline and follow a session

Choose **«Исправить issue» → «Новый запуск»**. The launch form selects [`examples/issue-lab`](../examples/issue-lab), a small dependency-free project with a bug and three failing tests. The source is intentionally broken so every run can fix its own copy.

1. **«Разбор задачи»** analyzes the code and runs tests in one session.
2. **«Выполнение»** receives the analysis and copied files in a new session, then implements a fix.
3. **«Проверка»** checks the result in another session.

For your own task, enter an absolute project path and describe the task or issue, or start without files. Each stage starts in a separate working copy and receives the previous stages' completed results, handoff context and files. A full-access session can still write outside that copy; see [access profiles](#access-profiles).

Click a stage circle to open its session. Inspect commands and output, file changes, input and handoff. Send a clarification with **⌘ Enter**. Technical approval requests appear in the session when the chosen access profile requires them; each approval applies once.

The session occupies the main workspace. The expand button at its top right hides navigation; click it again to restore navigation. Open run history through **«Запуск N»**. A completed session shows a compact result instead of a disabled message field.

While a tab stays open, it retains each attempt's message draft, selected attempts and scroll positions when switching stages, jobs and the editor. Message drafts disappear after a page reload. Job edits save automatically to disk.

## Continue, retry or start again

| Action                                    | Result                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **«Новый запуск» → «Запустить с начала»** | Start a new run from the beginning                                                                            |
| **«Повторить отсюда»**                    | Create a new attempt at the selected stage and rerun later stages                                             |
| Send a message                            | Steer an active turn or resume the existing waiting, failed or stopped attempt, keeping its session and files |
| **«Продолжить»** after completion         | Reuse finished results and append new stages to the same run                                                  |

Retry can use an adjusted instruction for that run only. Earlier attempts, sessions and files remain available. Editing a job in the constructor affects future work; it does not rewrite completed attempts.

**«Продолжить»** is available even when the template has no new stages. Select a completed run in the preview, then use stages appended to the job or describe a manual next step. A manual step belongs only to that run and does not change the template. Green rows identify results that will be reused; new instructions appear below them. The first stage does not execute again.

You can edit the new prompts for this continuation only. Describe the action, for example: “Compare the candidates by complexity, project activity and competing PRs; choose one and explain why.” You do not need to paste the previous search result into the prompt. New sessions receive the original run task, preceding reports and handoffs, and a copy of the last completed stage's files.

If completed prompts or planner settings have changed, the preview warns that their old results will be reused. Retry from the affected stage to apply changed instructions to completed work. A reordered or shortened template can still be followed by a manual step. Previously generated stages remain in the run; new fixed stages follow the completed plan. Repeating the same continuation request does not create duplicate sessions.

Choose the access profile for new stages in the continuation preview. Earlier attempts keep their original access history.

## Pipeline assistant

Open **«Помощник»**, describe the end goal and choose **«Глубоко проверить»**. A separate Codex session with high reasoning effort receives all stage prompts and summaries from up to three recent runs. It reviews goal coverage, missing or redundant steps, handoff contracts, completion criteria, dynamic stage creation and publication requirements.

The review shows findings with concrete evidence, unresolved requirements and a complete proposed pipeline. Expand a stage to see the reason for a change, its full new prompt and the original instruction. **«Применить к джобе»** saves the proposal to the template; **«Отменить применение»** restores its previous state. Neither action starts a run or changes access permissions. If the job was edited after analysis or application, stale apply/undo requests are rejected to preserve those edits.

The assistant reviews supplied instructions and result summaries; it does not verify repository code or external facts. It runs read-only with network disabled and uses your Codex account limits. One assistant review can run alongside pipeline execution. It can be stopped independently, and closing the dialog does not cancel it.

The last 20 reviews persist locally. After a runner restart, interrupted reviews must be restarted explicitly. Long history fields are clipped; very large review inputs are rejected with an explanation.

## Access profiles

Choose **«Доступ»** in the header to set a job's default. All its stages, including generated ones, inherit this profile. The setting is saved to disk and included in template export/import. The launch form allows an override for one run.

| Profile                         | Writes                       | Network    | Technical approvals                  |
| ------------------------------- | ---------------------------- | ---------- | ------------------------------------ |
| **С подтверждениями** (default) | Working directory            | On request | Requested when needed                |
| **Рабочая папка + сеть**        | Working directory            | Enabled    | Required outside sandbox permissions |
| **Полный доступ**               | No Codex sandbox restriction | Enabled    | Disabled                             |

Workspace profiles restrict writes, not all reads: Codex's read-access policy still applies. Full access runs with your OS user's permissions and can access files outside the working copy. Use it for trusted tasks and prompts. Host or administrator policies can still restrict execution.

Each run snapshots its profile. Editing a job does not change an active session. Continuation selects access for its new stages without changing earlier attempts. Questions about requirements (`needs_input` and requests for an answer) remain interactive in every profile. Disabling technical approvals does not answer business decisions or expand task scope. See the [Codex permission protocol](https://developers.openai.com/codex/app-server).

Pushes, PRs, publishing and messages must be explicitly requested in the task or stage. There is no separate editor for these actions yet.

## Local data, export and recovery

| Location                                    | Contents                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `.pipeline-data/workspace.json`             | Projects, folders and job templates; atomic writes with a `.bak` backup         |
| `.pipeline-data/runs.json`                  | Runs, attempt instructions, messages, activities, results and Codex session IDs |
| `.pipeline-data/reviews.json`               | Assistant reviews, proposals and original template snapshots for undo           |
| `.pipeline-data/workspaces/<run>/<attempt>` | Working files for each attempt                                                  |

These files are excluded from Git. If `workspace.json` is damaged, the runner restores its backup and shows a notification. Run and review stores retain history but do not have the workspace store's backup-recovery guarantees.

On first connection, legacy jobs migrate automatically from localStorage without removing the browser's original data. If the server already has jobs, migration is available separately through the data menu.

The **«Изменения»** section shows the selected attempt's directory. After a runner restart, interrupted sessions are marked stopped and do not restart automatically. Resume one explicitly with a message or retry the stage. Previously completed results and working files remain available.

Open **«Джобы и данные»** at the top right to view save status or export/import JSON. Export transfers projects, folders and job templates, not sessions or working files. Import adds missing jobs and preserves changed versions as separate copies. Importing an identical file again does not duplicate jobs. Back up the entire data directory when moving machines. Avoid large workspaces in directories subject to cloud offloading.

When multiple tabs edit at once, the app detects a conflict. Save your changes as separate copies or load the server version. Until a write succeeds, edits remain in the open tab and, when localStorage is available, in that tab's local draft. Failed writes are not reported as successful saves.

## Source copying and stage handoff

Source copying excludes Git metadata, dependencies, caches, build output, local `.env` files, key files and symlinks. The copy limit is **10,000 files / 150 MB**.

Handoff keeps generated artifacts, including `dist` and `coverage`, while omitting `.git`, `node_modules` and symlinks. Each new attempt gets a fresh local Git baseline for diffs. Restore dependencies and repository context inside the stage's directory when needed; do not assume the original Git history or installed packages carry over.

The copy mechanism is not a security boundary in full-access mode. Working directories are retained until you manage them yourself.

## Stages that create stages

In the constructor, select a stage and open **«Промпт» → «Может создавать этапы»**. That planner can return zero to five new stages with names and standalone prompts. They are inserted immediately after it, before the remaining fixed stages, and run in separate Codex sessions. The run limit is 50 stages; the number a planner may add decreases as the limit approaches.

Stages are inserted only after a successful `done`. A `needs_input` outcome waits for an answer; the planner can produce its plan after resuming. Generated stages have a sparkle marker and cannot create stages themselves. The expansion belongs only to the run and leaves the job template unchanged.

Retrying a planner moves its previous generated stages into **«Предыдущие планы»**, preserving conversation, attempts and files. Retrying one generated stage preserves the current stage order. The planner's context includes references to stages it created, including archived ones.

To reuse a successful plan, choose **«История запусков» → «Сохранить план как джобу»**. This creates a separate job with fixed stages. The planner's instruction is replaced with context preparation for those stages. Edit names and prompts before the next run if needed.

## Current limits

- One pipeline stage executes at a time; additional runs queue. Waiting for user input after a completed turn does not block other runs. One separate assistant review can run alongside execution.
- Pipelines are linear: no branching, parallel stages or visual condition editor yet.
- Codex is the only connected executor; Claude Code is not integrated.
- Structured outcomes support `done`, `needs_input`, `failed` and `skipped`.
- Message drafts are tab-local and disappear on reload. Runs and working directories are not deleted automatically.
- This is a local tool for one user, without multi-user authentication or a hosted execution service.

## Development and architecture

The interface uses React 19, TypeScript, Vinext/Vite, Tailwind and Base UI, with a circular pipeline constructor. It sends commands over REST and receives state through server-sent events (SSE). Vite proxies `/api/runner` to the local Node runner, which talks to `codex app-server` over JSONL/stdio. A new attempt gets a separate Codex thread; resuming with a message adds a turn to the same thread, while continuing a completed run creates new stages with separate sessions.

The Codex app-server protocol is evolving; recheck integration after CLI upgrades. The scaffold includes public OpenAI Sites and Cloudflare plugins, but local use does not require Sites registration. `npm run build` validates the frontend; its output alone, including a Cloudflare Workers build, cannot run the local Codex executor. Hosted product execution is not configured.

```sh
npm run test:runner
npm run typecheck
npm run lint
npm run build
```

Tests use fake Codex clients and temporary directories: no account, paid model calls or personal jobs are needed. CI runs these checks. [`examples/issue-lab`](../examples/issue-lab) is an intentionally broken demonstration fixture, not part of the application test suite.

Storage tests cover migration, imports, tab conflicts, backup recovery, retries after network errors and edits during saving. Planner tests cover stage insertion, separate sessions, recursion limits, archival and protection against duplicate results. Assistant tests cover apply/undo, edit conflicts, idempotency, stopping, timeouts, persistence failures and proposal validation. Runner tests cover sequencing, duplicate completion, invalid results, waiting for answers, steer/resume, approvals, stop/retry history, restarts, lifecycle races and artifact handoff.

See [contribution rules](../CONTRIBUTING.md), [development workflow](development-workflow.md), [architecture and invariants](architecture.md), [release checklist](releases.md) and the [agent playbook](../AGENTS.md).

Independent project; not an official OpenAI product. Licensed under [MIT](../LICENSE).
