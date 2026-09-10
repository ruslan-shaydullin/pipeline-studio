# Architecture and runtime contracts

Pipeline Studio is a single-user local web application. React/Vinext sends actions through `/api/runner`; Vite proxies them to the Node server on `127.0.0.1:4317`. The server publishes state through server-sent events (SSE). A local `codex app-server` process communicates with the runner using JSONL over stdio.

## Code map

| Responsibility | Source |
| --- | --- |
| Editor, sessions and assistant UI | `app/` |
| Shared records and continuation rules | `lib/pipeline.ts`, `lib/use-runner.ts`, `lib/continuation.mjs` |
| Browser persistence client and outbox | `lib/workspace-client.mjs`, `lib/use-workspace.ts` |
| HTTP actions and SSE | `server/index.mjs` |
| Stage execution, handoff and retries | `server/runner.mjs` |
| Codex JSONL transport | `server/codex.mjs` |
| Job storage, validation and imports | `server/workspace.mjs` |
| Reviews, proposal validation and apply/undo | `server/advisor.mjs`, `lib/advisor.mjs` |

Codex is the only connected executor today, even though the template schema can represent other agent names.

## Core records

**Projects and folders** organize jobs. A **job** is a reusable pipeline template: task, description, ordered stage definitions and a default access profile.

A **run** owns an execution snapshot, including its task, model, access profile, source path, ordered run stages and cursor. Editing a job does not rewrite existing runs.

A **run stage** retains its saved definition, effective prompt, status, attempts and `activeAttemptId`. Template stages, generated stages (`generatedBy`) and manually appended stages (`addedManually`) have distinct provenance.

An **attempt** is an execution of a stage with its own working directory and Codex thread. It retains the input, prompt, access profile, activities, pending requests, diff and structured outcome. Resuming it can add another turn to the same thread.

## Stage lifecycle

Runs start `queued`. The scheduler executes one pipeline stage at a time. A stage attempt becomes `running`; a blocking approval or tool question changes it to `waiting_approval`. Answering that request returns it to `running`.

A completed turn must produce a validated outcome with `status`, `summary`, `handoff` and `artifacts`:

| Outcome | Runner behavior |
| --- | --- |
| `done` / `skipped` | Finish the stage, advance the cursor, queue the next stage or finish the run |
| `needs_input` | Keep the cursor and set the attempt, stage and run to `waiting_user` |
| `failed` | Keep the cursor and mark the attempt, stage and run as failed |

A completed Codex turn alone is insufficient to advance. Invalid output or transport failures fail the attempt. Stopping execution invalidates pending work; late completion events must not revive it.

## New run, retry, resume and continuation

| Operation | Behavior |
| --- | --- |
| New run | Start a new execution of the template from the beginning |
| Retry from a stage | Create a new attempt there and rerun downstream stages, retaining previous attempts |
| Message / resume | Steer an active turn, or resume the current waiting/failed/stopped attempt with its existing thread and directory |
| Continue a completed run | Reuse finished results and append new stages, retaining previous attempts |

Completed-run continuation requires finished or skipped active attempts and the last handoff directory. It can append new template stages or one manual step belonging only to that run. Changes to completed template prompts/settings require acknowledging reuse of their old results; those old stages do not execute their updated instructions. Reordered templates can still be followed by a manual step.

Manual and generated stages remain in history and handoff, but are excluded when matching the template's fixed prefix. `templatePrompt` preserves the original baseline separately from run-only retry instructions; older records fall back to the first attempt's prompt.

Authorized planner stages can insert up to five following stages after a successful `done`. Generated stages cannot generate more stages. The run limit is 50 stages. Retrying a planner archives its previous generated expansion before replacing it.

## Files and handoff

Each new attempt gets a separate directory. The first copies the supplied source directory; later attempts copy the preceding stage's active directory and receive summaries/handoffs from preceding active attempts. The runner initializes a fresh local Git baseline for diffs.

Initial source copying excludes Git metadata, dependencies, caches, build outputs, common secret files and symlinks. Handoff preserves generated artifacts, including build outputs, while omitting `.git`, `node_modules` and symlinks. New sessions must restore Git context and dependencies when needed. A full-access session is not contained by this copy mechanism.

When changing a template's artifact contract, provide a way for new stages to consume older results. Editing a completed stage's template does not create a renamed artifact in its saved workspace.

## Persistence and recovery

The default directory is `.pipeline-data`; `PIPELINE_DATA_DIR` overrides it.

| Location | Contents |
| --- | --- |
| `workspace.json`, `workspace.json.bak` | Projects, folders and job templates, with revision, epoch and mutation receipts |
| `runs.json` | Run history, active attempts and archived stages |
| `reviews.json` | Last 20 assistant reviews, proposals and original snapshots |
| `workspaces/<run>/<attempt>` | Attempt working directories |
| `advisor/<review>` | Separate advisor session directory |

Workspace changes use atomic replacement, revision/epoch checks and mutation IDs. The browser keeps unsaved edits in a per-tab outbox and exposes conflicts. Restoring a workspace backup creates a new epoch, preventing stale clients from overwriting the restored state.

Runs and reviews use separate atomic files and do not have the workspace store's backup-recovery guarantees. Restart preserves history, marks interrupted execution stopped, clears obsolete pending RPC requests and marks interrupted reviews failed. It does not automatically restart paid work.

Template export/import does not transfer real sessions or working files. `workspace.runs` contains legacy/demo history; the live executor's run store is `runs.json`.

## Access and assistant boundaries

Access is explicit, saved on a run and snapshotted on each attempt. New turns and resumed threads apply that attempt's policy. Continuation can select access for new stages without rewriting earlier attempts. Technical approvals do not answer questions about requirements.

The assistant uses a separate Codex client and read-only session, allowing one review alongside pipeline execution. It receives the job and recent result summaries; it does not verify repository contents or external facts. Its proposal can change the task, description and stages. Apply/Undo require a matching target-job fingerprint, preserving intervening edits. Neither action changes access or starts a run.

## Invariants

1. Saved attempts and their files remain available across template edits, retries and continuation.
2. Mutation retries and duplicate completion events do not create duplicate continuation work or stage expansion.
3. An old asynchronous event cannot advance a different attempt or turn, or revive stopped work.
4. Revision/epoch conflicts and failed disk writes cannot silently discard edits or report a successful save.
5. Generated prompts and assistant proposals cannot increase permissions or silently answer human decisions.
6. The server validates state-changing actions; a frontend check is not the authority.

## Changing stored contracts

Current stores declare version 1, but there is no general migration framework. Plan compatibility explicitly and use small synthetic legacy fixtures. Preserve IDs, relationships, attempts, archived history, stage provenance and template baselines. Do not silently reset unreadable data.

Exercise the affected restart, continuation, retry, conflict and lost-response paths when changing a contract. Document one-way migrations and recovery in the release notes. Tests use temporary data and fake Codex clients, never personal job directories.
