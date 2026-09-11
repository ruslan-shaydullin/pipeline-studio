# README screenshot

`pipeline-studio.png` shows the actual pipeline editor with the selected stage's prompt. It was captured from commit `143d86c` in Chromium at a 1440 × 920 CSS-pixel viewport with a device scale factor of 2, using the light theme.

The screenshot uses synthetic data derived from `lib/workspace-seed.json`: the `issue-fix`, `feature` and `code-review` jobs in a single project named «Учебный проект». Run history is empty. A temporary, read-only HTTP fixture supplies workspace and connection state to a separate frontend copy. Codex is disconnected; no model session runs and no personal data directory is opened.

To refresh the image, use an isolated preview with equivalent sample data, open «Исправить issue» → «Конструктор» and select «Разбор задачи». Keep the stage prompts, text and status indicators unmodified. Capture the browser viewport after fonts and saved state have loaded, then check the image at README display size. This is a product illustration, not evidence of a live Codex run.
