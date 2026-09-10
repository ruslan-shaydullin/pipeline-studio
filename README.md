# Pipeline Studio

A local web workspace for repeatable jobs made of independent Codex sessions. Define each stage with a prompt, run the pipeline, and open any stage to follow the agent's commands, changes and conversation.

English · [Русский](README.ru.md)

**Early prototype.** The interface is currently in Russian. Execution runs on your computer through Codex CLI; this is a single-user tool, not a hosted service.

## What works

- Projects, folders and reusable pipeline templates, saved locally.
- Sequential stages with separate sessions and automatic handoff of results and files.
- Live session messages, command output, diffs, approval requests and model selection.
- Repeated runs, retries from a selected stage, and continuation from completed results with template stages or a manual next step.
- Deep pipeline reviews by Codex: goal coverage, evidence from recent runs, revised prompts, explicit apply and undo.
- Optional planners that create up to five following stages; save an expanded plan as a reusable job.
- Access profiles for the entire pipeline, with a per-run override.
- Job export/import, conflict detection between tabs and backup recovery.

## Quick start

Requirements: Node.js **22.13+**, npm, Git, and an authenticated [Codex CLI](https://developers.openai.com/codex/cli). The adapter has been checked with `codex-cli 0.153.4`. macOS is the primary tested platform; Linux is covered by CI for installation, tests and build. Other platforms and CLI versions may need integration work.

```sh
git clone https://github.com/ruslan-shaydullin/pipeline-studio.git
cd pipeline-studio
npm ci
codex login
npm run dev
```

Open [localhost:3000](http://localhost:3000). This starts both the web UI and the local runner on `127.0.0.1:4317`. `npm start` is an alias for the same local development setup. Closing a browser tab does not stop a run; stopping the server interrupts active sessions and preserves their history.

If ChatGPT/Codex desktop is installed at its standard macOS path, its bundled CLI is selected first. Set `PIPELINE_CODEX_BIN` to use a specific CLI executable:

```sh
PIPELINE_CODEX_BIN="$(command -v codex)" npm run dev
```

The app uses the selected CLI's existing login and account limits. No API key is copied into the frontend. Check that you are signed in with the same CLI executable the runner uses.

## Try a pipeline

Choose **«Исправить issue» → «Новый запуск»**. The launch form selects `examples/issue-lab`, a tiny dependency-free project with failing tests. Three sessions analyze the issue, implement a fix, and verify the result.

For your own task, enter a project directory or start without files. Each stage starts in a separate working copy. Results and files from the previous stage are handed over automatically. Click a stage to inspect its session or send a message.

**Continue vs. rerun:** after a run finishes, choose **«Продолжить»** to reuse completed results. Append stages to the job or describe a manual next step in the preview. A manual step belongs to that run and does not change the template. **«Новый запуск»** starts from the beginning. **«Повторить отсюда»** creates a new attempt at an existing stage and reruns later stages. Earlier attempts remain available.

If completed prompts or planner settings changed, the preview explains that continuation will reuse their old results. Reordered or removed template stages can still be followed by a manual step. New stages receive the original run task, handoff and files; retries and continuations retain earlier attempts.

To let a stage create more stages, enable **«Может создавать этапы»** beneath its prompt. Generated stages cannot create more stages themselves. The current limit is 50 stages per run.

## Pipeline assistant

Open **«Помощник»**, describe the end goal and choose **«Глубоко проверить»**. A separate Codex session with high reasoning effort reviews every stage prompt and summaries from up to three recent runs. It checks goal coverage, missing steps, redundant work, handoff contracts, completion criteria, dynamic stage creation and publication requirements.

The review shows concrete findings, unresolved decisions and a complete proposed pipeline. Expand a stage to compare its full new prompt with the original. **«Применить к джобе»** saves the proposal to the template; **«Отменить применение»** restores its previous state. Neither action starts a run or changes access permissions. If someone edits the job after analysis or application, stale apply/undo requests are rejected to preserve those edits.

The assistant reviews supplied instructions and result summaries; it does not verify repository code or external facts. It runs read-only with network disabled, uses your Codex account limits and can be stopped independently of stage execution. Closing the dialog does not cancel it. The last 20 reviews persist locally; interrupted reviews must be restarted. Long history fields are clipped and very large review inputs are rejected explicitly.

## Access profiles

Choose **«Доступ»** in the header to set the job's default. All stages, including generated ones, inherit it. The launch form allows an override for one run.

| Profile | Writes | Network | Technical approvals |
| --- | --- | --- | --- |
| **С подтверждениями** (default) | Working directory | On request | Requested when needed |
| **Рабочая папка + сеть** | Working directory | Enabled | Required outside sandbox permissions |
| **Полный доступ** | No Codex sandbox restriction | Enabled | Disabled |

Workspace profiles restrict writes, not all reads; Codex's read-access policy still applies. Full access runs with your OS user's permissions and can access files outside the working copy. Use it for trusted tasks and prompts. Host or administrator policies can still restrict execution. Questions about requirements remain interactive in every profile: disabling technical approvals does not answer business decisions or expand task scope.

Each run snapshots its profile. Editing a job does not change an active session. When continuing a completed run, choose the profile for its new stages in the preview. Existing attempts keep their original access history. [Codex permission protocol](https://developers.openai.com/codex/app-server).

## Local data

- `.pipeline-data/workspace.json`: projects, folders and job templates, with an atomic-write backup.
- `.pipeline-data/runs.json`: run history, messages, results and Codex session IDs.
- `.pipeline-data/reviews.json`: assistant reviews, proposals and their original template snapshots.
- `.pipeline-data/workspaces/<run>/<attempt>`: working files for each attempt.

These files are excluded from Git. Export/import transfers job templates, not session history or working files. Back up the entire data directory when moving machines. Avoid placing large development workspaces in folders subject to cloud offloading.

Source copying excludes Git metadata, dependencies, build output, local `.env` files, key files and symlinks. Handoff preserves generated artifacts but still omits `.git`, `node_modules` and symlinks. Copy limit: 10,000 files / 150 MB. A copy is not a security boundary in full-access mode.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `PIPELINE_CODEX_BIN` | Path to the Codex executable |
| `PIPELINE_DATA_DIR` | Data directory; defaults to `.pipeline-data` |
| `PIPELINE_PORT` | Runner port; changing it also requires updating the Vite proxy |

Keep the runner local. It has no multi-user authentication and is not designed to be exposed to a network.

## Development

```sh
npm run test:runner
npm run typecheck
npm run lint
npm run build
```

Tests use a fake Codex client and temporary data directories: no account, paid model calls or personal jobs are needed. CI runs the same checks. `examples/issue-lab` intentionally contains failing tests until an agent fixes its isolated copy; it is not part of the application test suite.

React 19, TypeScript, Vinext/Vite, Tailwind and Base UI power the interface. The Node runner talks to `codex app-server` over JSONL/stdio and publishes state over SSE. The scaffold includes the public OpenAI Sites and Cloudflare plugins; no Sites registration is needed for local use. `npm run build` validates the frontend build, but its output alone cannot run the local Codex executor.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development notes.

## Current limits

One active pipeline stage at a time; additional runs are queued. One separate assistant review may run alongside it. Pipelines are linear: no branching, parallel stages or visual condition editor yet. Codex is the only connected executor. Message drafts are tab-local and do not survive a page reload. Working directories are retained until you manage them yourself.

An independent project, not an official OpenAI product. Licensed under [MIT](LICENSE).
