import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, seed } from './fixtures';
import type { AgentRun } from '../../lib/use-runner';

async function readyPage(page: Page) {
  await expect(
    page.getByText('Локальный исполнитель подключён', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Новая джоба', exact: true }),
  ).toBeEnabled();
}

test.beforeEach(async ({ page, app }) => {
  await page.goto(app.url);
  await readyPage(page);
});

async function launch(page: Page) {
  await page
    .getByRole('button', { name: 'Новый запуск', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Новый запуск',
    exact: true,
  });
  await dialog
    .getByLabel('Задача этого запуска')
    .fill('Сохранить кандидата и передать его следующему этапу.');
  await dialog.getByLabel('Папка с исходниками').fill('');
  await dialog
    .getByRole('button', { name: 'Запустить с начала', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function editStage(page: Page, name: string, prompt: string) {
  await page
    .getByRole('textbox', { name: 'Название этапа', exact: true })
    .fill(name);
  await page
    .getByRole('textbox', { name: 'Инструкция этапа', exact: true })
    .fill(prompt);
}
async function continueManually(page: Page) {
  await page
    .getByRole('button', { name: 'Продолжить', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Продолжить с результатами',
    exact: true,
  });
  await dialog.getByLabel('Название следующего шага').fill('Отбор кандидата');
  await dialog
    .getByRole('textbox', {
      name: 'Инструкция следующего этапа: Отбор кандидата',
      exact: true,
    })
    .fill('E2E:READ Проверь сохранённый candidate.txt без нового поиска.');
  await dialog.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
const active = (run: AgentRun, index: number) => {
  const stage = run.stages[index];
  const attempt = stage.attempts.find((a) => a.id === stage.activeAttemptId);
  if (!attempt) throw new Error(`Missing active attempt for stage ${index}`);
  return attempt;
};

test('create a job, restart, continue manually, then append a template stage without repeating completed work', async ({
  page,
  app,
}) => {
  await page.getByRole('button', { name: 'Новая джоба', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Новая джоба', exact: true });
  await create
    .getByLabel('Название', { exact: true })
    .fill('Контрибьют без повторного поиска');
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить первый этап' }).click();
  await editStage(
    page,
    'Поиск кандидата',
    'E2E:WRITE Сохрани выбранного кандидата в candidate.txt.',
  );
  await launch(page);
  await expect
    .poll(async () => (await app.state()).runs[0]?.status)
    .toBe('done');
  const first = (await app.state()).runs[0];
  const original = active(first, 0);
  const artifact = await readFile(
    path.join(original.cwd, 'candidate.txt'),
    'utf8',
  );
  await expect(
    page.getByText(original.outcome!.summary, { exact: true }).first(),
  ).toBeVisible();

  await app.restartRunner();
  await page.reload();
  await readyPage(page);
  await page
    .getByRole('button', {
      name: 'Контрибьют без повторного поиска',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', { name: 'Продолжить', exact: true }).first(),
  ).toBeEnabled();
  await continueManually(page);
  await expect
    .poll(async () => (await app.state()).runs[0]?.stages[1]?.status)
    .toBe('done');
  const second = (await app.state()).runs[0];
  expect(second.id).toBe(first.id);
  expect(active(second, 0)).toEqual(original);
  expect(second.stages[1].addedManually).toBe(true);
  expect(active(second, 1).threadId).not.toBe(original.threadId);
  expect(
    await readFile(path.join(active(second, 1).cwd, 'candidate.txt'), 'utf8'),
  ).toBe(artifact);

  await page.getByRole('tab', { name: 'Конструктор', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Добавить этап после «Поиск кандидата»',
      exact: true,
    })
    .click();
  await editStage(page, 'Проверка шаблона', 'E2E:READ Проверь candidate.txt.');
  await page
    .getByRole('button', { name: 'Продолжить', exact: true })
    .first()
    .click();
  const continuation = page.getByRole('dialog', {
    name: 'Продолжить с результатами',
    exact: true,
  });
  await expect(
    continuation.getByRole('textbox', {
      name: 'Инструкция следующего этапа: Проверка шаблона',
    }),
  ).toHaveValue('E2E:READ Проверь candidate.txt.');
  await continuation
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  await expect
    .poll(async () => (await app.state()).runs[0]?.stages[2]?.status)
    .toBe('done');
  const final = (await app.state()).runs[0];
  expect(final.id).toBe(first.id);
  expect(final.stages.slice(0, 2)).toEqual(second.stages);
  expect(final.stages).toHaveLength(3);
  expect((await app.state()).runs).toHaveLength(1);
  expect(
    (await app.requests()).filter((r) => r.method === 'thread/start'),
  ).toHaveLength(3);
  await page
    .getByRole('button', { name: 'Проверка шаблона', exact: true })
    .click();
  await expect(
    page.getByText(`Проверен файл: ${artifact}`, { exact: true }).first(),
  ).toBeVisible();
});

test('a question pauses downstream work and resumes the same saved session after a runner restart', async ({
  page,
  app,
}) => {
  await page.getByRole('tab', { name: 'Конструктор', exact: true }).click();
  await page
    .getByRole('button', { name: /Поиск кандидата/ })
    .first()
    .click();
  await editStage(
    page,
    'Выбор кандидата',
    'E2E:ASK Спроси, какой кандидат нужен.',
  );
  await page
    .getByRole('button', {
      name: 'Добавить этап после «Выбор кандидата»',
      exact: true,
    })
    .click();
  await editStage(
    page,
    'Проверка выбора',
    'E2E:READ Прочитай выбранного кандидата.',
  );
  await launch(page);
  await expect
    .poll(async () => (await app.state()).runs[0]?.status)
    .toBe('waiting_user');
  const paused = (await app.state()).runs[0];
  const attempt = active(paused, 0);
  expect(paused.stages[1].attempts).toHaveLength(0);
  await expect(
    page
      .getByText('Какой кандидат нужен: alpha или beta?', { exact: true })
      .first(),
  ).toBeVisible();
  await app.restartRunner();
  await page.reload();
  await readyPage(page);
  await page
    .getByRole('textbox', { name: 'Сообщение агенту', exact: true })
    .fill('Выбирай beta.');
  await page
    .getByRole('button', { name: 'Отправить сообщение агенту', exact: true })
    .click();
  await expect
    .poll(async () => (await app.state()).runs[0]?.status)
    .toBe('done');
  const resumed = (await app.state()).runs[0];
  expect(resumed.id).toBe(paused.id);
  expect(resumed.stages[0].attempts).toHaveLength(1);
  expect(active(resumed, 0)).toMatchObject({
    id: attempt.id,
    threadId: attempt.threadId,
    cwd: attempt.cwd,
  });
  expect(active(resumed, 0).turnId).not.toBe(attempt.turnId);
  expect(active(resumed, 0).items.some((i) => i.text === 'Выбирай beta.')).toBe(
    true,
  );
  expect(
    await readFile(path.join(active(resumed, 1).cwd, 'candidate.txt'), 'utf8'),
  ).toBe('Выбирай beta.');
  await page
    .getByRole('button', { name: 'Проверка выбора', exact: true })
    .click();
  await expect(
    page.getByText('Проверен файл: Выбирай beta.', { exact: true }).first(),
  ).toBeVisible();
});

test('retry creates a separate attempt and keeps the old session available', async ({
  page,
  app,
}) => {
  await launch(page);
  await expect
    .poll(async () => (await app.state()).runs[0]?.status)
    .toBe('done');
  const original = active((await app.state()).runs[0], 0);
  await page
    .getByRole('button', { name: 'Повторить отсюда', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Повторить с этапа «Поиск кандидата»',
    exact: true,
  });
  await dialog
    .getByLabel('Инструкция новой попытки')
    .fill('E2E:WRITE Найди кандидата заново.');
  await dialog
    .getByRole('button', { name: 'Новая попытка', exact: true })
    .click();
  await expect
    .poll(
      async () => (await app.state()).runs[0]?.stages[0]?.attempts[1]?.status,
    )
    .toBe('done');
  const run = (await app.state()).runs[0];
  expect(run.stages[0].attempts[0]).toEqual(original);
  expect(active(run, 0).threadId).not.toBe(original.threadId);
  expect(active(run, 0).cwd).not.toBe(original.cwd);
  await page.getByRole('combobox', { name: 'Попытка этапа' }).click();
  await page.getByRole('option', { name: /Попытка 1/ }).click();
  await expect(
    page.getByText(original.outcome!.summary, { exact: true }).first(),
  ).toBeVisible();
  expect(
    await readFile(path.join(original.cwd, 'candidate.txt'), 'utf8'),
  ).toContain(original.threadId!);
});

test('assistant proposal persists, applies explicitly and can be undone without rewriting execution history', async ({
  page,
  app,
}) => {
  await launch(page);
  await expect
    .poll(async () => (await app.state()).runs[0]?.status)
    .toBe('done');
  const before = await app.workspace();
  const history = (await app.state()).runs;
  await page.getByRole('button', { name: 'Помощник', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Доведём пайплайн до цели' });
  await dialog
    .getByRole('button', { name: 'Глубоко проверить', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Применить к джобе', exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByText('Результат не проверяется', { exact: true }),
  ).toBeVisible();
  expect(await app.workspace()).toEqual(before);
  await app.restartRunner();
  await page.reload();
  await readyPage(page);
  await page.getByRole('button', { name: 'Помощник', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Доведём пайплайн до цели' });
  await dialog
    .getByRole('button', { name: 'Применить к джобе', exact: true })
    .click();
  await expect
    .poll(async () => (await app.workspace()).pipelines[0].stages.length)
    .toBe(2);
  const applied = (await app.workspace()).pipelines[0];
  expect(applied.stages[0].id).toBe(seed.pipelines[0].stages[0].id);
  expect(applied.accessMode).toBe('supervised');
  expect((await app.state()).runs).toEqual(history);
  await page.reload();
  await readyPage(page);
  await page.getByRole('button', { name: 'Помощник', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Доведём пайплайн до цели' })
    .getByRole('button', { name: 'Отменить применение', exact: true })
    .click();
  await expect.poll(async () => await app.workspace()).toEqual(before);
  expect((await app.state()).runs).toEqual(history);
});

test('editing a reviewed job disables its stale proposal and the server rejects applying it', async ({
  page,
  app,
}) => {
  await page.getByRole('button', { name: 'Помощник', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Доведём пайплайн до цели' });
  await dialog
    .getByRole('button', { name: 'Глубоко проверить', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Применить к джобе', exact: true }),
  ).toBeEnabled();
  const review = (await app.state()).reviews![0];
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Конструктор', exact: true }).click();
  await page
    .getByRole('button', { name: /Поиск кандидата/ })
    .first()
    .click();
  await editStage(
    page,
    'Новые требования',
    'E2E:WRITE Найди кандидата по изменённым критериям.',
  );
  await page.getByRole('button', { name: 'Помощник', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Применить к джобе', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(async () => (await app.workspace()).pipelines[0].stages[0].name)
    .toBe('Новые требования');
  const response = await page.request.post(
    `${app.url}/api/runner/reviews/${review.id}/apply`,
    { headers: { 'X-Pipeline-Client': 'local-v1' } },
  );
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    error: expect.stringContaining('Джоба изменилась после разбора'),
  });
  expect((await app.workspace()).pipelines[0].stages).toHaveLength(1);
  await dialog
    .getByRole('button', { name: 'Разобрать заново', exact: true })
    .click();
  await expect
    .poll(async () => (await app.state()).reviews![0].id)
    .not.toBe(review.id);
  await expect
    .poll(async () => (await app.state()).reviews![0].status)
    .toBe('done');
  await expect(
    dialog.getByRole('button', { name: 'Применить к джобе', exact: true }),
  ).toBeEnabled();
  expect((await app.state()).reviews![0].id).not.toBe(review.id);
});
