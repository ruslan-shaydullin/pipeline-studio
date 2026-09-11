'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderSearch, Loader2 } from 'lucide-react';
import {
  runnerAction,
  type WorkspaceCopyOptions,
  type WorkspaceCopyReport,
} from '@/lib/use-runner';

const MIB = 1024 * 1024;
const numberFormat = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
});

export type WorkspaceCopyDraft = { maxFiles: string; maxMiB: string };

export function workspaceCopyDraft(
  options?: WorkspaceCopyOptions,
): WorkspaceCopyDraft {
  return {
    maxFiles: String(options?.maxFiles ?? 10000),
    maxMiB: String((options?.maxBytes ?? 150 * MIB) / MIB),
  };
}

export function workspaceCopyOptions(
  draft: WorkspaceCopyDraft,
): WorkspaceCopyOptions | null {
  const maxFiles = Number(draft.maxFiles);
  const maxBytes = Math.round(Number(draft.maxMiB) * MIB);
  return Number.isSafeInteger(maxFiles) &&
    maxFiles > 0 &&
    Number.isSafeInteger(maxBytes) &&
    maxBytes > 0
    ? { maxFiles, maxBytes }
    : null;
}

function formatBytes(bytes: number) {
  return bytes >= MIB
    ? `${numberFormat.format(bytes / MIB)} МиБ`
    : bytes >= 1024
      ? `${numberFormat.format(bytes / 1024)} КиБ`
      : `${numberFormat.format(bytes)} Б`;
}

export function WorkspaceCopySummary({
  report,
  handoff = false,
}: {
  report: WorkspaceCopyReport;
  handoff?: boolean;
}) {
  return (
    <div className="copy-report">
      <p className="copy-report-total">
        <strong>{numberFormat.format(report.fileCount)} файлов</strong>
        <span>{formatBytes(report.bytes)}</span>
      </p>
      <p className="field-hint">
        Лимиты: {numberFormat.format(report.limits.maxFiles)} файлов /{' '}
        {formatBytes(report.limits.maxBytes)}. Исключено файлов и папок:{' '}
        {numberFormat.format(report.excludedCount)}.
      </p>
      {!!report.excludedCount && (
        <p className="field-hint">
          Исключённая папка считается один раз, без подсчёта её содержимого.
        </p>
      )}
      {!!report.exceeded.length && (
        <p className="runner-error" role="alert">
          Превышен лимит:{' '}
          {report.exceeded
            .map((limit) =>
              limit === 'files' ? 'число файлов' : 'объём копии',
            )
            .join(' и ')}
          .{' '}
          {handoff
            ? 'Увеличь лимиты или сократи ненужные созданные артефакты в файлах предыдущего этапа, затем проверь снова.'
            : 'Увеличь лимиты или исключи ненужные исходные файлы и проверь снова.'}
        </p>
      )}
      {!!report.ignoreFiles.length && (
        <p className="field-hint copy-ignore-files">
          Правила исключений: {report.ignoreFiles.join(', ')}.
        </p>
      )}
      {!!report.largestDirectories.length && (
        <details className="copy-breakdown" open>
          <summary>Самые большие папки</summary>
          <ul>
            {report.largestDirectories.map((directory) => (
              <li key={directory.path}>
                <code>{directory.path}</code>
                <span>
                  {numberFormat.format(directory.fileCount)} файлов ·{' '}
                  {formatBytes(directory.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!report.largestFiles.length && (
        <details className="copy-breakdown">
          <summary>Самые большие файлы</summary>
          <ul>
            {report.largestFiles.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span>{formatBytes(file.bytes)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type InspectionTarget =
  | { sourcePath: string }
  | { runId: string; stageId?: string };

export function WorkspaceCopySettings({
  draft,
  onChange,
  target,
  handoff = false,
  available,
  online,
  disabled = false,
}: {
  draft: WorkspaceCopyDraft;
  onChange: (draft: WorkspaceCopyDraft) => void;
  target: InspectionTarget;
  handoff?: boolean;
  available: boolean;
  online: boolean;
  disabled?: boolean;
}) {
  const options = workspaceCopyOptions(draft);
  const signature = JSON.stringify({ target, draft, available, online });
  const request = useRef(0);
  const [inspection, setInspection] = useState<{
    signature: string;
    pending?: boolean;
    report?: WorkspaceCopyReport;
    error?: string;
  } | null>(null);
  const current = inspection?.signature === signature ? inspection : null;
  if (inspection && inspection.signature !== signature) setInspection(null);
  useEffect(() => {
    return () => {
      request.current += 1;
    };
  }, [signature]);

  async function inspect() {
    if (!options || !available || !online || disabled) return;
    const requestId = ++request.current;
    setInspection({ signature, pending: true });
    try {
      const report = await runnerAction<WorkspaceCopyReport>(
        '/workspace/inspect',
        { ...target, copyOptions: options },
      );
      if (request.current === requestId) setInspection({ signature, report });
    } catch (error) {
      if (request.current === requestId)
        setInspection({ signature, error: (error as Error).message });
    }
  }

  return (
    <details className="workspace-copy-settings">
      <summary>
        <span>
          Копирование файлов
          {!available
            ? ' · требуется обновление'
            : !options
              ? ' · проверь лимиты'
              : ''}
        </span>
        <ChevronDown size={14} />
      </summary>
      {!available && (
        <p className="runner-error" role="alert">
          Настройки копирования недоступны. После завершения текущих запусков и
          проверок перезапусти локальный исполнитель, чтобы применить
          обновление.
        </p>
      )}
      <div className="copy-limit-fields">
        <label className="run-field">
          Максимум файлов
          <input
            type="number"
            min="1"
            step="1"
            required
            value={draft.maxFiles}
            disabled={disabled || !available}
            onChange={(event) =>
              onChange({ ...draft, maxFiles: event.target.value })
            }
          />
        </label>
        <label className="run-field">
          Максимальный объём, МиБ
          <input
            type="number"
            min={1 / MIB}
            step="any"
            required
            value={draft.maxMiB}
            disabled={disabled || !available}
            onChange={(event) =>
              onChange({ ...draft, maxMiB: event.target.value })
            }
          />
        </label>
      </div>
      {!options && (
        <p className="runner-error" role="alert">
          Число файлов должно быть целым и больше нуля, объём — не меньше одного
          байта. Проверь, что значения не слишком большие.
        </p>
      )}
      <p className="field-hint">
        {handoff
          ? 'Между этапами сохраняются созданные артефакты. Правила .gitignore и .pipelineignore при передаче не применяются; Git, зависимости и символьные ссылки не копируются.'
          : 'Учитываются .gitignore внутри исходной папки и .pipelineignore в её корне. Добавь в .pipelineignore ненужные папки или файлы, по одному правилу в строке: например, data/ или *.zip. Зависимости, типовые файлы секретов и символьные ссылки исключаются автоматически.'}
      </p>
      <p className="field-hint">
        Лимиты действуют для каждой новой копии этого запуска. Настройки и файлы
        прошлых попыток сохраняются. 1 МиБ = 1 048 576 байт.
      </p>
      <button
        type="button"
        className="secondary-button compact-button"
        disabled={
          disabled || !available || !online || !options || current?.pending
        }
        onClick={() => void inspect()}
      >
        {current?.pending ? (
          <Loader2 className="spin" size={14} />
        ) : (
          <FolderSearch size={14} />
        )}
        {current?.pending ? 'Считаем файлы…' : 'Проверить объём копии'}
      </button>
      <div aria-live="polite">
        {current?.error && (
          <p className="runner-error" role="alert">
            {current.error}
          </p>
        )}
        {current?.report && (
          <WorkspaceCopySummary report={current.report} handoff={handoff} />
        )}
      </div>
      {current?.report && (
        <p className="field-hint">
          Перед запуском объём проверяется повторно: содержимое папки могло
          измениться.
        </p>
      )}
    </details>
  );
}
