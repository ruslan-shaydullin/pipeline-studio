<p align="center">
  <img src="public/favicon.svg" width="56" height="56" alt="">
</p>

<h1 align="center">Pipeline Studio</h1>

<p align="center">Turn repeatable tasks into a pipeline of separate Codex sessions.<br>Give each stage a prompt; carry its results and files into the next.</p>

<p align="center">
  English · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/ruslan-shaydullin/pipeline-studio/actions/workflows/ci.yml"><img src="https://github.com/ruslan-shaydullin/pipeline-studio/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-22.13%2B-43853D" alt="Node.js 22.13 or newer"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="#try-your-first-pipeline">First pipeline</a> · <a href="docs/user-guide.md">User guide</a> · <a href="#documentation">Documentation</a>
</p>

<p align="center"><strong>Early prototype · Local, single user · Russian interface</strong></p>

![Pipeline Studio showing a three-stage issue-fixing pipeline with the selected stage's prompt](docs/images/pipeline-studio.png)

_Pipeline editor with a synthetic example. No live Codex run was used._

## What you can do

- **Build reusable jobs.** Organize templates into projects and folders, give each stage a prompt and select a model for the run.
- **Follow each session.** Inspect commands, output, file changes and conversation; answer questions or send a clarification while work runs.
- **Carry work forward.** Separate stage sessions pass results and files automatically. Retry a stage or continue a completed run without losing earlier attempts.
- **Review and expand a plan.** Ask the pipeline assistant for improvements, apply them explicitly, or let an authorized planner create following stages.
- **Keep control locally.** Choose an access profile, export/import templates and recover saved jobs from a backup. Runs retain their own execution history.

## Quick start

Install **Node.js 22.13+**, npm, Git and [Codex CLI](https://developers.openai.com/codex/cli). macOS is the primary tested platform; Linux CI covers installation, tests and build. Other platforms may need integration work.

```sh
git clone https://github.com/ruslan-shaydullin/pipeline-studio.git
cd pipeline-studio
npm ci
codex login
npm run dev
```

Open [localhost:3000](http://localhost:3000). The command starts the UI at `localhost:3000` and the local runner at `127.0.0.1:4317`. Closing the browser tab leaves a run active; stopping the server interrupts sessions and preserves their history.

On macOS, the runner first looks for the CLI bundled with `ChatGPT.app`, then falls back to `codex` on `PATH`. To use your terminal's CLI, run `PIPELINE_CODEX_BIN="$(command -v codex)" npm run dev`. Sign in with the executable the runner uses. The adapter has been checked with `codex-cli 0.153.4`; other versions may need integration work. Runs use your existing account limits.

## Try your first pipeline

Open **«Исправить issue» → «Новый запуск»**. The launch form selects [`examples/issue-lab`](examples/issue-lab), a small project with three intentionally failing tests. Start the run to follow three separate sessions:

1. **Analyze:** inspect the issue and reproduce the failing tests.
2. **Fix:** use the analysis and copied files to implement a correction.
3. **Verify:** check the result in another session and report the outcome.

Click a stage to see its session. The example source stays available for another run: agents work on separate copies. For your own task, select a project directory or start without files.

Choose **«Продолжить»** after completion to append work to that run. **«Повторить отсюда»** creates a new attempt and reruns later stages. [How continuation and retries differ →](docs/user-guide.md#continue-retry-or-start-again)

## Current limits

Stages run sequentially; additional runs queue. One assistant review can run alongside them. Pipelines have no branching or parallel stages, and Codex is the only connected executor. Message drafts disappear on reload; working copies require manual cleanup.

Keep the runner on your computer: it has no multi-user authentication. Working-copy isolation does not contain full-access sessions, which use your OS permissions. [Access profiles and file handling →](docs/user-guide.md#access-profiles)

## Documentation

- [User guide](docs/user-guide.md): sessions, continuation, the assistant, access and local data.
- [Contributing](CONTRIBUTING.md) and [development workflow](docs/development-workflow.md): setup, checks and PRs.
- [Architecture](docs/architecture.md): records, execution and persistence contracts.
- [Release checklist](docs/releases.md): preparing and publishing a version.

Independent project; not an official OpenAI product. Licensed under [MIT](LICENSE).
