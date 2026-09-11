# Changelog

## 0.1.0 — 2026-09-11

First public preview of Pipeline Studio: a local workspace for repeatable jobs made of independent Codex sessions.

- Projects, folders, editable stage prompts and locally saved jobs.
- Sequential execution with separate threads, file handoff, live activity, session messages and diffs.
- Continued runs reuse completed results; manual next steps and appended template stages preserve previous sessions. Retries retain earlier attempts.
- Pipeline access profiles, questions and explicit technical approvals.
- Optional stages that create following stages, with bounded expansion.
- Pipeline assistant with findings, a complete proposal and explicit apply/undo.
- Job import/export, concurrent-edit protection and recovery from workspace backups.
- Five Chromium regressions through real HTTP/SSE and JSONL transport with an isolated synthetic executor. CI also runs 66 runner/storage tests, TypeScript, lint and a production build.
- Configurable loopback UI and runner ports, isolated dependency caches, and primary actions disabled while jobs load.
- Updated React/RSC, Vite, Vinext and Cloudflare tooling dependencies to resolve the known advisories in the previous lockfile. The lockfile audit reports no known vulnerabilities at release preparation.

This is a source release under MIT, with a Russian interface. It is a local single-user tool using an authenticated Codex CLI, with linear execution and one active pipeline stage at a time. Hosted deployment, multi-user authentication, parallel branches and other model providers are not included.

No stored-data format migration is introduced. Before upgrading an existing checkout, stop active work and back up the entire configured data directory, including attempt files. See [upgrade and recovery](docs/releases.md#upgrade-and-recovery-notes).
