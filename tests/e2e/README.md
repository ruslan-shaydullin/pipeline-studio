# Browser scenarios

```sh
npm ci
npx playwright install chromium # Linux: npx playwright install --with-deps chromium
npm run test:e2e
```

The five Chromium scenarios cover job creation, file handoff, continuation after a runner restart, manual then template continuation, question/resume, retry history, persisted assistant proposals, apply/undo and stale-proposal rejection. Assertions inspect both the visible session and persisted identities/files. Test failures retain a Playwright trace, screenshot and synthetic service logs; inspect them with `npx playwright show-report` or `npx playwright show-trace <trace.zip>`.

The fixture copies an allowlist of source files into an OS temporary directory and links installed dependencies. It starts the real Vinext UI and Node runner on available loopback ports. Each test has a fresh workspace, data directory and browser context. Restarting the runner reuses that test's data. Teardown stops only processes owned by the fixture and removes temporary data. Existing localhost apps, `.pipeline-data` and runtime caches are never used. Tests run serially with no automatic retries.

`fake-codex.mjs` is an executable JSONL/stdio peer selected through the existing `PIPELINE_CODEX_BIN` setting. It requires `PIPELINE_FAKE_ROOT`, refuses work outside that directory, and never launches Codex. Synthetic prompts contain `E2E:WRITE`, `E2E:READ` or `E2E:ASK`; these markers are interpreted only by the fake, not by the application. The fake creates/reads actual artifacts and persists its synthetic threads so resume can be verified across process restarts. Missing artifacts or unknown instructions fail the stage.

This validates integration of the browser, HTTP/SSE, persistence, orchestration and transport. It does not establish model quality or compatibility with every Codex CLI version. Real account smoke tests remain separate from CI. CI runs on GitHub-hosted workers without model credentials and uploads failure artifacts for seven days.
