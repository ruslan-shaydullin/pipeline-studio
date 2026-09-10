'use client';
import { AccessSelect } from './access-settings';
import { accessModes } from '@/lib/access.mjs';
import type { AccessMode } from '@/lib/pipeline';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  ChevronDown,
  History,
  Maximize2,
  Minimize2,
  Copy,
  FileCode2,
  FolderOpen,
  GitBranch,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  Square,
  Sparkles,
  Save,
  Terminal,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  continuationPlan,
  continuationToken,
  recentRun,
} from '@/lib/continuation.mjs';
import type { Pipeline, Run } from '@/lib/pipeline';
import {
  runnerAction,
  statusLabels,
  type Activity,
  type AgentRun,
  type PendingRequest,
  type RunnerState,
  type RunStatus,
} from '@/lib/use-runner';

function StatusIcon({ status }: { status: RunStatus }) {
  if (status === 'running' || status === 'queued')
    return <Loader2 size={16} className="spin" />;
  if (status === 'done') return <Check size={16} />;
  if (status === 'failed') return <X size={16} />;
  if (status === 'waiting_user' || status === 'waiting_approval')
    return <MessageSquare size={16} />;
  return <span className="run-state-dot" />;
}
function OutcomeText({ text }: { text: string }) {
  if (text.trim().startsWith('{')) {
    let summary = '';
    try {
      summary = JSON.parse(text).summary || '';
    } catch {
      /* A streamed JSON result is not complete yet. */
    }
    return summary ? (
      <div className="message-text">{summary}</div>
    ) : (
      <span className="forming-result">Формирует результат…</span>
    );
  }
  return <div className="message-text">{text}</div>;
}
function ActivityItem({ item, initial }: { item: Activity; initial: boolean }) {
  if (item.type === 'userMessage')
    return initial ? (
      <details className="initial-input">
        <summary>
          Задача и инструкция этапа <ChevronRight size={14} />
        </summary>
        <pre>{item.text}</pre>
      </details>
    ) : (
      <div className="user-bubble">{item.text}</div>
    );
  if (item.type === 'agentMessage')
    return (
      <article className="agent-reply">
        <span className="reply-avatar">
          <Bot size={18} />
        </span>
        <div>
          <span className="reply-author">Codex</span>
          <OutcomeText text={item.text || ''} />
        </div>
      </article>
    );
  if (item.type === 'commandExecution')
    return (
      <details
        className={`activity-tool ${item.status === 'failed' ? 'tool-failed' : ''}`}
        open={item.status === 'inProgress'}
      >
        <summary>
          <Terminal size={15} />
          <code>{item.command || 'Выполняет команду'}</code>
          {item.status === 'inProgress' ? (
            <Loader2 size={13} className="spin" />
          ) : (
            <span className="tool-exit">
              {item.exitCode === undefined || item.exitCode === null
                ? item.status
                : `exit ${item.exitCode}`}
            </span>
          )}
        </summary>
        {item.aggregatedOutput && <pre>{item.aggregatedOutput}</pre>}
      </details>
    );
  if (item.type === 'fileChange')
    return (
      <details className="activity-tool">
        <summary>
          <FileCode2 size={15} />
          <span>Изменения файлов</span>
          <span className="tool-exit">{item.changes?.length || 0}</span>
        </summary>
        {item.changes?.map((change, i) => (
          <div key={i}>
            <div className="file-path">{change.path}</div>
            <pre>{change.diff}</pre>
          </div>
        ))}
      </details>
    );
  if (item.type === 'error')
    return <div className="runner-error">{item.text}</div>;
  if (item.type === 'notice')
    return <div className="session-notice">{item.text}</div>;
  return (
    <details className="activity-tool">
      <summary>
        <Bot size={15} />
        <span>
          {item.type === 'mcpToolCall'
            ? `${item.server || ''} · ${item.tool || 'Инструмент'}`
            : item.type === 'webSearch'
              ? 'Поиск в интернете'
              : 'План работы'}
        </span>
      </summary>
      <pre>{item.text || item.query || JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}
function ApprovalCard({
  pending,
  busy,
  onAnswer,
}: {
  pending: PendingRequest;
  busy: boolean;
  onAnswer: (value: object) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const isQuestion = pending.method.endsWith('requestUserInput');
  return (
    <form
      className="approval-card"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer({ answers });
      }}
    >
      <strong>
        <MessageSquare size={17} />
        {isQuestion ? 'Агенту нужен твой ответ' : 'Агент просит разрешение'}
      </strong>
      {pending.params.reason && <p>{pending.params.reason}</p>}
      {pending.params.command && <pre>{pending.params.command}</pre>}
      {isQuestion ? (
        <>
          {pending.params.questions?.map((q) => (
            <label key={q.id} className="approval-question">
              <span>{q.question}</span>
              {q.options?.map((option) => (
                <button
                  type="button"
                  key={option.label}
                  className={`answer-option ${answers[q.id] === option.label ? 'selected' : ''}`}
                  onClick={() =>
                    setAnswers((a) => ({ ...a, [q.id]: option.label }))
                  }
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
              <input
                type={q.isSecret ? 'password' : 'text'}
                required
                value={answers[q.id] || ''}
                onChange={(e) =>
                  setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                }
                placeholder="Твой ответ"
              />
            </label>
          ))}
          <button className="primary-button" disabled={busy}>
            Ответить
          </button>
        </>
      ) : (
        <div className="approval-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => onAnswer({ decision: 'accept' })}
          >
            Разрешить один раз
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => onAnswer({ decision: 'decline' })}
          >
            Отклонить
          </button>
        </div>
      )}
    </form>
  );
}
export function RunLauncher({
  open,
  onOpenChange,
  pipeline,
  runner,
  onCreated,
  preferredRunId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  runner: RunnerState & { online: boolean };
  onCreated: (run: AgentRun) => void;
  preferredRunId?: string | null;
}) {
  const [snapshot] = useState(() => structuredClone(pipeline));
  const candidates = runner.runs.filter(
    (r) => continuationPlan(r, snapshot).eligible,
  );
  const [baseId, setBaseId] = useState(
    () =>
      candidates.find((r) => r.id === preferredRunId)?.id ||
      candidates[0]?.id ||
      '',
  );
  const [mode, setMode] = useState<'continue' | 'new'>(() =>
    baseId ? 'continue' : 'new',
  );
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState<{
    signature: string;
    id: string;
  } | null>(null);
  const base = runner.runs.find((r) => r.id === baseId);
  const [accessMode, setAccessMode] = useState<AccessMode>(
    snapshot.accessMode ?? base?.accessMode ?? 'supervised',
  );
  const plan = base ? continuationPlan(base, snapshot) : null;
  const applied = base?.continuations?.some((c) => c.id === operation?.id);
  const previous = runner.runs.find(
    (r) => r.pipelineId === snapshot.id && r.status === 'done',
  );
  const [expectedState, setExpectedState] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(candidates.map((r) => [r.id, continuationToken(r)])),
  );
  const continuing = mode === 'continue';
  const [task, setTask] = useState(
      pipeline.task ||
        runner.runs.find((r) => r.pipelineId === pipeline.id)?.task ||
        '',
    ),
    [sourcePath, setSourcePath] = useState(
      runner.runs.find((r) => r.pipelineId === pipeline.id)?.sourcePath ||
        (pipeline.id === 'issue-fix' ? runner.examplePath || '' : ''),
    ),
    [model, setModel] = useState('default');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      let run: AgentRun;
      if (continuing && applied && base) {
        onCreated(base);
        onOpenChange(false);
        return;
      }
      if (continuing) {
        if (!base || !plan?.eligible)
          throw new Error(
            plan?.reason ||
              'Этот результат уже изменился. Открой продолжение заново',
          );
        const value = {
          pipeline: snapshot,
          accessMode,
          overrides: Object.fromEntries(
            plan.added
              .filter((s) => overrides[s.id] !== undefined)
              .map((s) => [s.id, overrides[s.id]]),
          ),
          expectedState: expectedState[base.id],
        };
        const signature = JSON.stringify(value);
        const requestOperation =
          operation?.signature === signature
            ? operation
            : { signature, id: crypto.randomUUID() };
        setOperation(requestOperation);
        run = await runnerAction('/runs/' + base.id + '/extend', {
          ...value,
          mutationId: requestOperation.id,
        });
      } else
        run = await runnerAction('/runs', {
          pipelineId: snapshot.id,
          accessMode,
          name: snapshot.name,
          task,
          sourcePath,
          stages: snapshot.stages,
          model: model === 'default' ? '' : model,
        });
      onCreated(run);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
    >
      <DialogContent className="run-launcher">
        <DialogHeader>
          <DialogTitle>
            {continuing ? 'Продолжить с результатами' : 'Новый запуск'}
          </DialogTitle>
          <DialogDescription>
            {continuing
              ? 'Готовые этапы и их файлы сохранятся. Выполнятся только новые шаги.'
              : 'Выполнятся все этапы с начала, в новых сессиях.'}
          </DialogDescription>
        </DialogHeader>
        {!baseId &&
          previous &&
          snapshot.stages.length >
            previous.stages.filter((s) => !s.generatedBy).length && (
            <p className="field-hint">
              Продолжение недоступно:{' '}
              {continuationPlan(previous, snapshot).reason}.
            </p>
          )}
        {!!baseId && (
          <div className="launch-mode" aria-label="Способ запуска">
            <button
              disabled={busy}
              type="button"
              aria-pressed={continuing}
              onClick={() => setMode('continue')}
            >
              Продолжить с результатами
            </button>
            <button
              disabled={busy}
              type="button"
              aria-pressed={!continuing}
              onClick={() => setMode('new')}
            >
              Новый запуск
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {continuing ? (
            <div className="continuation-preview">
              <label className="run-field" htmlFor="continuation-base">
                Результат запуска
              </label>
              <Select
                value={baseId}
                disabled={busy}
                onValueChange={(v) => {
                  const selected = candidates.find((r) => r.id === String(v));
                  if (selected)
                    setExpectedState((old) => ({
                      ...old,
                      [selected.id]: continuationToken(selected),
                    }));
                  setBaseId(String(v));
                  setError('');
                }}
              >
                <SelectTrigger
                  id="continuation-base"
                  aria-label="Продолжить результат запуска"
                >
                  <SelectValue>
                    {base
                      ? new Date(base.createdAt).toLocaleString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Выбрать запуск'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((r) => (
                    <SelectItem value={r.id} key={r.id}>
                      {new Date(r.createdAt).toLocaleString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {r.stages.length} этап.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {base && <p className="continuation-task">{base.task}</p>}
              {applied ? (
                <p className="session-notice">
                  Продолжение уже запущено. Открой его сессию.
                </p>
              ) : plan?.eligible ? (
                <>
                  <div className="continuation-label">
                    Используем готовый результат
                  </div>
                  {plan.reused.map((s) => (
                    <details className="reused-stage" key={s.id}>
                      <summary>
                        <Check size={14} />
                        <span>{s.name}</span>
                        <small>Готово</small>
                        <ChevronDown size={12} />
                      </summary>
                      <p>
                        {
                          s.attempts.find((a) => a.id === s.activeAttemptId)
                            ?.outcome?.summary
                        }
                      </p>
                    </details>
                  ))}
                  <div className="continuation-label">Выполним дальше</div>
                  {plan.added.map((s) => (
                    <label className="run-field continuation-stage" key={s.id}>
                      <span>
                        <Play size={12} />
                        {s.name}
                      </span>
                      <textarea
                        aria-label={'Инструкция следующего этапа: ' + s.name}
                        disabled={busy}
                        value={overrides[s.id] ?? s.prompt}
                        onChange={(e) =>
                          setOverrides((old) => ({
                            ...old,
                            [s.id]: e.target.value,
                          }))
                        }
                        rows={5}
                        maxLength={30000}
                      />
                    </label>
                  ))}
                  <p className="field-hint">
                    Каждый шаг получит результаты и файлы предыдущих этапов.
                    Здесь можно уточнить инструкции только для этого
                    продолжения.
                  </p>
                </>
              ) : (
                <p className="runner-error">
                  {plan?.reason || 'Результат недоступен'}
                </p>
              )}
            </div>
          ) : (
            <>
              <label className="run-field">
                Задача этого запуска
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={5}
                  required
                  placeholder="Ссылка на issue, требования и ожидаемый результат"
                />
              </label>
              <label className="run-field">
                Папка с исходниками
                <input
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  placeholder="/Users/…/project"
                />
              </label>
              <p className="field-hint">
                Для каждого этапа создаётся отдельная копия. Зависимости, .env и
                символьные ссылки не копируются. Пустое поле — начать без
                файлов.
              </p>
              {runner.examplePath && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSourcePath(runner.examplePath || '')}
                >
                  <FolderOpen size={14} /> Учебный проект с падающими тестами
                </button>
              )}
              <label className="run-field" htmlFor="run-model">
                Модель
              </label>
              <Select value={model} onValueChange={(v) => setModel(String(v))}>
                <SelectTrigger id="run-model">
                  <SelectValue>
                    {model === 'default'
                      ? `По умолчанию · ${runner.models.find((m) => m.isDefault)?.name || 'Codex'}`
                      : runner.models.find((m) => m.id === model)?.name ||
                        model}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">По умолчанию в Codex</SelectItem>
                  {runner.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <AccessSelect
            value={accessMode}
            onChange={setAccessMode}
            disabled={busy || !!applied || !runner.accessProfiles}
          />
          {runner.online && !runner.accessProfiles && (
            <p className="field-hint">
              Перезапусти локальный исполнитель после завершения текущего
              запуска, чтобы применить обновление доступа.
            </p>
          )}
          <p className="field-hint">
            {continuing
              ? 'Режим для новых этапов этого продолжения. Выполненные сессии сохраняются.'
              : 'Для всех этапов этого запуска. Изменение здесь не меняет настройки джобы.'}
          </p>
          {(!runner.online || !runner.connected || !runner.account) && (
            <div className="runner-error">
              {!runner.online
                ? 'Локальный исполнитель недоступен. Запусти npm run dev.'
                : runner.error ||
                  'Войди в Codex командой codex login и перезапусти исполнитель.'}
            </div>
          )}
          {error && !applied && (
            <div role="alert" className="runner-error">
              {error}
            </div>
          )}
          <div className="run-launch-footer">
            <span>Использует текущий аккаунт Codex</span>
            <button
              className="primary-button"
              disabled={
                busy ||
                !runner.online ||
                !runner.connected ||
                !runner.account ||
                !runner.accessProfiles ||
                (continuing &&
                  !applied &&
                  (!plan?.eligible ||
                    plan.added.some(
                      (s) => !(overrides[s.id] ?? s.prompt).trim(),
                    )))
              }
            >
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}{' '}
              {continuing
                ? applied
                  ? 'Открыть продолжение'
                  : 'Продолжить'
                : 'Запустить с начала'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function RunsPanel({
  pipeline,
  runner,
  selectedId,
  onSelect,
  focusTarget,
  active,
  expanded,
  onToggleExpanded,
  onLaunch,
  legacyRuns,
  onSaveAsJob,
}: {
  pipeline: Pipeline;
  runner: RunnerState & { online: boolean };
  selectedId: string | null;
  onSelect: (id: string) => void;
  focusTarget: { runId: string; stageId: string } | null;
  active: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onLaunch: () => void;
  legacyRuns: Run[];
  onSaveAsJob: (run: AgentRun, name: string) => Promise<void>;
}) {
  const runs = runner.runs.filter((r) => r.pipelineId === pipeline.id);
  const run: AgentRun | undefined =
    runs.find((r) => r.id === selectedId) || recentRun(runs);
  const [selections, setSelections] = useState<
    Record<string, { stageId: string; attemptId: string }>
  >({});
  const [tab, setTab] = useState('conversation');
  const [savePlan, setSavePlan] = useState(false);
  const [jobName, setJobName] = useState('');
  const [handledTarget, setHandledTarget] = useState<typeof focusTarget>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rememberedAttempts, setRememberedAttempts] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [retry, setRetry] = useState(false),
    [retryPrompt, setRetryPrompt] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef<Record<string, { top: number; pinned: boolean }>>(
    {},
  );
  const selection = run && selections[run.id];
  const stage =
    run?.stages.find((s) => s.id === selection?.stageId) ||
    run?.archivedStages?.find((s) => s.id === selection?.stageId) ||
    run?.stages[Math.min(run?.cursor || 0, (run?.stages.length || 1) - 1)];
  const attempt =
    stage?.attempts.find((a) => a.id === selection?.attemptId) ||
    stage?.attempts.find((a) => a.id === stage.activeAttemptId) ||
    stage?.attempts.at(-1);
  const archived = !!stage?.archivedAt;
  const creator = run?.stages.find((s) => s.id === stage?.generatedBy?.stageId);
  const creatorAttempt = creator?.attempts.find(
    (a) => a.id === stage?.generatedBy?.attemptId,
  );
  const message = attempt ? drafts[attempt.id] || '' : '';
  const errorKey = attempt?.id || run?.id || '';
  const error = errors[errorKey] || '';
  function setError(text: string) {
    setErrors((previous) => ({ ...previous, [errorKey]: text }));
  }
  function selectStage(stageId: string, attemptId?: string) {
    if (!run) return;
    const key = run.id + '/' + stageId;
    const remembered = attemptId ?? rememberedAttempts[key] ?? '';
    if (attemptId !== undefined) {
      setRememberedAttempts((previous) => ({ ...previous, [key]: attemptId }));
    }
    setSelections((previous) => ({
      ...previous,
      [run.id]: { stageId, attemptId: remembered },
    }));
    setError('');
    setRetry(false);
  }
  if (focusTarget !== handledTarget) {
    setHandledTarget(focusTarget);
    if (focusTarget) {
      setSelections((previous) => ({
        ...previous,
        [focusTarget.runId]: { stageId: focusTarget.stageId, attemptId: '' },
      }));
      setTab('conversation');
    }
  }
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!active || tab !== 'conversation' || !attempt || !element) return;
    const restore = () => {
      const position = positions.current[attempt.id];
      element.scrollTop =
        position?.pinned === false ? position.top : element.scrollHeight;
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    return () => observer.disconnect();
  }, [attempt, tab, active]);
  async function action(route: string, body: object = {}) {
    setBusy(true);
    setError('');
    try {
      await runnerAction(route, body);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const activeAttempt =
    !archived && !!attempt && stage?.activeAttemptId === attempt.id;
  const canMessage =
    runner.online &&
    activeAttempt &&
    !!attempt.threadId &&
    run?.stages[run.cursor]?.id === stage?.id &&
    ['running', 'waiting_user', 'failed', 'stopped'].includes(run.status) &&
    !attempt.pending.length;
  const canRetry =
    !archived &&
    !!run &&
    !!stage?.attempts.length &&
    !['queued', 'running', 'waiting_approval'].includes(run.status);
  const stoppable =
    !!run &&
    ['queued', 'running', 'waiting_approval', 'waiting_user'].includes(
      run.status,
    );
  return (
    <div className="live-runs">
      {!runner.online && (
        <div className="runner-offline">
          Соединяемся с локальным исполнителем… История появится после
          подключения.
        </div>
      )}
      {runner.error && <div className="runner-error">{runner.error}</div>}
      {run ? (
        <div className="live-runs-layout">
          <section className="live-run-content">
            <div className="live-run-heading">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="run-switcher"
                  aria-label="История запусков"
                  disabled={busy}
                >
                  <History size={15} />
                  <span>Запуск {runs.length - runs.indexOf(run)}</span>
                  <ChevronDown size={13} />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="run-history-menu"
                  sideOffset={8}
                >
                  <div className="run-history-heading">
                    История запусков <span>{runs.length}</span>
                  </div>
                  {runs.map((r, i) => (
                    <DropdownMenuItem
                      key={r.id}
                      className={
                        'run-history-item' +
                        (r.id === run.id ? ' selected' : '')
                      }
                      onClick={() => {
                        onSelect(r.id);
                        setError('');
                        setRetry(false);
                      }}
                    >
                      <span className={'state-icon state-' + r.status}>
                        <StatusIcon status={r.status} />
                      </span>
                      <span className="run-history-copy">
                        <strong>
                          Запуск {runs.length - i}{' '}
                          <small>{statusLabels[r.status]}</small>
                        </strong>
                        <span>{r.task}</span>
                        <time>
                          {new Date(r.createdAt).toLocaleString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </span>
                      {r.id === run.id && (
                        <Check size={14} className="history-selected" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  {run.stages.some((s) => s.generatedBy) && (
                    <DropdownMenuItem
                      onClick={() => {
                        setJobName(pipeline.name + ' · готовый план');
                        setSavePlan(true);
                        setError('');
                      }}
                    >
                      <Save size={14} /> Сохранить план как джобу
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="run-history-new"
                    onClick={onLaunch}
                  >
                    <Play size={14} /> Новый запуск
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <h2 title={run.task}>{run.task}</h2>
              <span className={'run-status-label state-' + run.status}>
                <StatusIcon status={run.status} />
                <span>{statusLabels[run.status]}</span>
              </span>
              <span className="run-access-label" title="Доступ этого запуска">
                {
                  accessModes.find(
                    (option) =>
                      option.value === (run.accessMode ?? 'supervised'),
                  )?.label
                }
              </span>
              {stoppable && (
                <button
                  className="secondary-button compact-button"
                  disabled={busy}
                  onClick={() => void action('/runs/' + run.id + '/stop')}
                >
                  <Square size={12} /> Остановить
                </button>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className="icon-button session-expand"
                      aria-label={
                        expanded ? 'Свернуть сессию' : 'Развернуть сессию'
                      }
                      aria-pressed={expanded}
                      onClick={onToggleExpanded}
                    />
                  }
                >
                  {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </TooltipTrigger>
                <TooltipContent>
                  {expanded ? 'Свернуть сессию' : 'Развернуть сессию'}
                </TooltipContent>
              </Tooltip>
            </div>
            {continuationPlan(run, pipeline).eligible && (
              <div className="continue-run-notice">
                <span>
                  В джобе появились новые этапы. Готовый результат можно
                  использовать дальше.
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={onLaunch}
                >
                  Продолжить <ChevronRight size={13} />
                </button>
              </div>
            )}
            <div className="session-stage-track" aria-label="Этапы запуска">
              {run.stages.map((s, i) => (
                <div className="session-stage-group" key={s.id}>
                  <button
                    className={`session-stage ${s.id === stage?.id ? 'selected' : ''} state-${s.status} palette-${s.appearance}`}
                    disabled={busy}
                    onClick={() => selectStage(s.id)}
                    title={
                      s.name +
                      ' · ' +
                      statusLabels[s.status] +
                      (s.generatedBy ? ' · Создан агентом' : '')
                    }
                    aria-pressed={s.id === stage?.id}
                  >
                    <span className="mini-orb">
                      {s.status === 'idle' ? (
                        i + 1
                      ) : (
                        <StatusIcon status={s.status} />
                      )}
                    </span>
                    <span>{s.name}</span>
                    {s.generatedBy && (
                      <Sparkles
                        className="generated-stage-mark"
                        size={11}
                        aria-label="Создан агентом"
                      />
                    )}
                  </button>
                  {i < run.stages.length - 1 && (
                    <span className="mini-connection" />
                  )}
                </div>
              ))}
            </div>
            {!!run.archivedStages?.length && (
              <div className="plan-history-bar">
                <DropdownMenu>
                  <DropdownMenuTrigger className="text-button" disabled={busy}>
                    <History size={13} />
                    Предыдущие планы · {run.archivedStages.length}
                    <ChevronDown size={12} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="plan-history-menu">
                    {run.archivedStages.map((s) => {
                      const parent = run.stages.find(
                        (p) => p.id === s.generatedBy?.stageId,
                      );
                      const generation = parent?.attempts.find(
                        (a) => a.id === s.generatedBy?.attemptId,
                      )?.number;
                      return (
                        <DropdownMenuItem
                          key={s.id}
                          onClick={() => selectStage(s.id)}
                        >
                          <span>
                            <strong>{s.name}</strong>
                            <small>
                              {parent?.name || 'Планировщик'} · попытка{' '}
                              {generation || '—'}
                            </small>
                          </span>
                          {s.id === stage?.id && <Check size={13} />}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                {archived && (
                  <button
                    className="text-button"
                    onClick={() =>
                      selectStage(
                        run.stages[Math.min(run.cursor, run.stages.length - 1)]
                          .id,
                      )
                    }
                  >
                    К текущему плану <ChevronRight size={12} />
                  </button>
                )}
              </div>
            )}
            {stage && (
              <div className="live-session">
                {attempt ? (
                  <>
                    <Tabs
                      value={tab}
                      onValueChange={(v) => setTab(String(v))}
                      className="live-session-tabs"
                    >
                      <div className="session-toolbar">
                        <TabsList variant="line" aria-label="Содержимое этапа">
                          <TabsTrigger value="conversation">Сессия</TabsTrigger>
                          <TabsTrigger value="changes">
                            Изменения {attempt.diff ? '•' : ''}
                          </TabsTrigger>
                          <TabsTrigger value="context">Контекст</TabsTrigger>
                        </TabsList>
                        <div className="session-head-actions">
                          {stage.attempts.length > 0 && (
                            <Select
                              disabled={busy}
                              value={attempt?.id || ''}
                              onValueChange={(v) =>
                                selectStage(stage.id, String(v))
                              }
                            >
                              <SelectTrigger
                                className="attempt-select"
                                aria-label="Попытка этапа"
                              >
                                <SelectValue>
                                  Попытка {attempt?.number}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {stage.attempts.map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    Попытка {a.number}
                                    {a.id !== stage.activeAttemptId
                                      ? ' · история'
                                      : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <button
                            className="text-button session-retry"
                            title="Повторить отсюда"
                            aria-label="Повторить отсюда"
                            disabled={!canRetry || busy}
                            onClick={() => {
                              setRetryPrompt(attempt?.prompt || stage.prompt);
                              setRetry(true);
                            }}
                          >
                            <RotateCcw size={14} />{' '}
                            <span>Повторить отсюда</span>
                          </button>
                        </div>
                      </div>
                      <TabsContent
                        value="conversation"
                        className="conversation-tab"
                        keepMounted
                      >
                        <div
                          className="conversation-scroll"
                          aria-label="Переписка с агентом"
                          ref={scroll}
                          onScroll={() => {
                            if (!active || tab !== 'conversation') return;
                            const e = scroll.current!;
                            positions.current[attempt.id] = {
                              top: e.scrollTop,
                              pinned:
                                e.scrollHeight - e.scrollTop - e.clientHeight <
                                100,
                            };
                          }}
                        >
                          <div className="conversation-column" key={attempt.id}>
                            {stage.generatedBy && (
                              <div className="session-notice generated-notice">
                                <Sparkles size={13} />
                                {archived
                                  ? 'Этап из предыдущего плана'
                                  : 'Создан агентом'}{' '}
                                · {creator?.name || 'Планировщик'} · попытка{' '}
                                {creatorAttempt?.number || '—'}
                              </div>
                            )}
                            {!activeAttempt && !archived && (
                              <div className="session-notice">
                                Предыдущая попытка · её результат сохранён для
                                сравнения
                              </div>
                            )}
                            {attempt.items.map((item, i) => (
                              <ActivityItem
                                key={item.id}
                                item={item}
                                initial={i === 0}
                              />
                            ))}
                            {attempt.status === 'running' && (
                              <div className="agent-working">
                                <Loader2 size={14} className="spin" /> Codex
                                работает
                              </div>
                            )}
                            {attempt.error && (
                              <div className="runner-error">
                                {attempt.error}
                              </div>
                            )}
                            {attempt.status === 'waiting_user' &&
                              attempt.outcome && (
                                <div className="waiting-note">
                                  {attempt.outcome.handoff ||
                                    'Напиши ответ ниже, чтобы продолжить этот этап.'}
                                </div>
                              )}
                            {activeAttempt &&
                              attempt.pending.map((pending) => (
                                <ApprovalCard
                                  key={pending.id}
                                  pending={pending}
                                  busy={busy}
                                  onAnswer={(value) =>
                                    void action(`/runs/${run.id}/answer`, {
                                      attemptId: attempt.id,
                                      requestId: pending.id,
                                      ...value,
                                    })
                                  }
                                />
                              ))}
                            {!attempt.items.length && (
                              <div className="agent-working">
                                <Loader2 size={14} className="spin" />{' '}
                                Подготавливает рабочую папку и сессию
                              </div>
                            )}
                          </div>
                        </div>
                      </TabsContent>
                      <TabsContent value="changes" className="session-info-tab">
                        <div className="workspace-path">
                          <FolderOpen size={16} />
                          <span>{attempt.cwd}</span>
                          <button
                            className="icon-button"
                            aria-label="Копировать путь к файлам"
                            onClick={() =>
                              void navigator.clipboard.writeText(attempt.cwd)
                            }
                          >
                            <Copy size={15} />
                          </button>
                        </div>
                        {attempt.diff ? (
                          <pre className="full-diff">{attempt.diff}</pre>
                        ) : (
                          <div className="session-notice">
                            {['running', 'waiting_approval'].includes(
                              attempt.status,
                            )
                              ? 'Diff появится после завершения хода агента. Текущие действия видны в сессии.'
                              : 'Изменений исходников нет.'}
                          </div>
                        )}
                      </TabsContent>
                      <TabsContent value="context" className="session-info-tab">
                        <dl className="session-context">
                          {stage.generatedBy && (
                            <>
                              <dt>Создан этапом</dt>
                              <dd>
                                {creator?.name || 'Планировщик'} · попытка{' '}
                                {creatorAttempt?.number || '—'}
                                {archived ? ' · предыдущий план' : ''}
                              </dd>
                            </>
                          )}
                          {attempt.expansion && (
                            <>
                              <dt>Созданные этапы</dt>
                              <dd>
                                {attempt.expansion.stageIds.length
                                  ? attempt.expansion.stageIds.map((id) => {
                                      const child = [
                                        ...run.stages,
                                        ...(run.archivedStages || []),
                                      ].find((s) => s.id === id);
                                      return (
                                        child && (
                                          <button
                                            className="text-button created-stage-link"
                                            key={id}
                                            onClick={() => selectStage(id)}
                                          >
                                            <Sparkles size={12} />
                                            {child.name}
                                            <ChevronRight size={12} />
                                          </button>
                                        )
                                      );
                                    })
                                  : 'Новых этапов не потребовалось'}
                              </dd>
                            </>
                          )}
                          <dt>Модель</dt>
                          <dd>
                            {attempt.model ||
                              run.model ||
                              'По умолчанию в Codex'}
                          </dd>
                          <dt>Инструкция этой попытки</dt>
                          <dd className="message-text">{attempt.prompt}</dd>
                          <dt>Входной контекст</dt>
                          <dd>
                            <pre>{attempt.input}</pre>
                          </dd>
                          {attempt.outcome && (
                            <>
                              <dt>Результат для следующего этапа</dt>
                              <dd className="message-text">
                                {attempt.outcome.handoff}
                              </dd>
                              {attempt.outcome.artifacts.length > 0 && (
                                <>
                                  <dt>Файлы</dt>
                                  <dd>
                                    {attempt.outcome.artifacts.map((f) => (
                                      <div className="artifact-path" key={f}>
                                        <FileCode2 size={14} />
                                        {f}
                                      </div>
                                    ))}
                                  </dd>
                                </>
                              )}
                            </>
                          )}
                          <dt>Сессия Codex</dt>
                          <dd>
                            <code>{attempt.threadId || 'Создаётся'}</code>
                          </dd>
                        </dl>
                      </TabsContent>
                    </Tabs>
                    <div className="session-composer-area">
                      {error && (
                        <div role="alert" className="runner-error">
                          {error}
                        </div>
                      )}
                      {canMessage ||
                      attempt.status === 'running' ||
                      attempt.status === 'waiting_approval' ? (
                        <form
                          className={`session-composer ${!canMessage ? 'disabled' : ''}`}
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!canMessage || busy || !message.trim()) return;
                            if (
                              await action(`/runs/${run.id}/message`, {
                                attemptId: attempt.id,
                                text: message,
                              })
                            )
                              setDrafts((previous) => ({
                                ...previous,
                                [attempt.id]: '',
                              }));
                          }}
                        >
                          <textarea
                            value={message}
                            onChange={(e) =>
                              setDrafts((previous) => ({
                                ...previous,
                                [attempt.id]: e.target.value,
                              }))
                            }
                            disabled={!canMessage || busy}
                            placeholder={
                              canMessage
                                ? run.status === 'running'
                                  ? 'Уточнить задачу, пока агент работает…'
                                  : 'Написать агенту и продолжить эту сессию…'
                                : attempt.pending.length
                                  ? 'Ответь на запрос агента выше, чтобы продолжить…'
                                  : 'Ожидаем подключения к сессии…'
                            }
                            aria-label="Сообщение агенту"
                            rows={2}
                            onKeyDown={(e) => {
                              if (
                                e.key === 'Enter' &&
                                (e.metaKey || e.ctrlKey)
                              ) {
                                e.preventDefault();
                                if (canMessage && message.trim() && !busy)
                                  e.currentTarget.form?.requestSubmit();
                              }
                            }}
                          />
                          <button
                            type="submit"
                            className="send-message"
                            aria-label="Отправить сообщение агенту"
                            disabled={!canMessage || !message.trim() || busy}
                          >
                            {busy ? (
                              <Loader2 size={17} className="spin" />
                            ) : (
                              <ArrowUp size={18} />
                            )}
                          </button>
                        </form>
                      ) : (
                        <div className="session-ended">
                          <span>
                            <StatusIcon status={attempt.status} />{' '}
                            {activeAttempt
                              ? statusLabels[attempt.status]
                              : 'Предыдущая попытка'}{' '}
                            · сессия сохранена
                          </span>
                          {canRetry && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setRetryPrompt(attempt.prompt);
                                setRetry(true);
                              }}
                            >
                              Изменить инструкцию и повторить{' '}
                              <ChevronRight size={13} />
                            </button>
                          )}
                        </div>
                      )}
                      {canMessage && (
                        <div className="composer-hint">
                          <span>Уточнение получит только эта сессия</span>
                          <span>⌘ Enter</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="stage-not-started">
                    <GitBranch size={28} />
                    <h3>
                      {stage.attempts.length
                        ? 'Этап будет выполнен повторно'
                        : 'Этап ещё не начался'}
                    </h3>
                    <p>Запустится после завершения предыдущего этапа.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="first-run-empty">
          <span className="first-run-symbol">
            <GitBranch size={30} />
          </span>
          <h2>Одна джоба. Много итераций.</h2>
          <p>
            Запусти задачу и открой любой этап.
            <br />
            Команды, изменения и диалог с агентом появятся здесь.
          </p>
          <button className="primary-button" onClick={onLaunch}>
            <Play size={15} fill="currentColor" /> Первый запуск
          </button>
        </div>
      )}
      {legacyRuns.length > 0 && (
        <details className="legacy-runs">
          <summary>Предыдущие демо-запуски · {legacyRuns.length}</summary>
          {legacyRuns.map((r) => (
            <details key={r.id}>
              <summary>
                {new Date(r.time).toLocaleString('ru-RU')} · {r.completed}/
                {r.stages.length}
              </summary>
              <pre>{r.task}</pre>
              {r.stages.map((s) => (
                <div key={s.id}>
                  <strong>{s.name}</strong>
                  <pre>{s.prompt}</pre>
                </div>
              ))}
            </details>
          ))}
        </details>
      )}
      <Dialog
        open={savePlan}
        onOpenChange={(v) => {
          if (!busy) setSavePlan(v);
        }}
      >
        <DialogContent className="retry-dialog">
          <DialogHeader>
            <DialogTitle>Сохранить план как джобу</DialogTitle>
            <DialogDescription>
              Этапы плана ({run?.stages.length || 0}) станут фиксированными.
              Планировщик будет готовить контекст для этих шагов. Новую джобу
              можно запускать и редактировать отдельно.
            </DialogDescription>
          </DialogHeader>
          <label className="launcher-label">
            Название джобы
            <input
              maxLength={160}
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
            />
          </label>
          <ol className="import-job-list">
            {run?.stages.map((s) => (
              <li key={s.id}>
                {s.name}
                {s.allowStageCreation ? ' · подготовка контекста' : ''}
              </li>
            ))}
          </ol>
          {error && (
            <div role="alert" className="runner-error">
              {error}
            </div>
          )}
          <button
            className="primary-button"
            disabled={busy || !jobName.trim()}
            onClick={async () => {
              if (!run) return;
              setBusy(true);
              setError('');
              try {
                await onSaveAsJob(run, jobName);
                setSavePlan(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            Сохранить джобу
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={retry}
        onOpenChange={(open) => {
          if (!busy) setRetry(open);
        }}
      >
        <DialogContent className="retry-dialog">
          <DialogHeader>
            <DialogTitle>Повторить с этапа «{stage?.name}»</DialogTitle>
            <DialogDescription>
              Новая сессия получит файлы предыдущего этапа. Последующие этапы
              выполнятся заново; старые попытки останутся в истории.
            </DialogDescription>
          </DialogHeader>
          <label className="run-field">
            Инструкция новой попытки
            <textarea
              value={retryPrompt}
              onChange={(e) => setRetryPrompt(e.target.value)}
              rows={9}
            />
          </label>
          {error && <div className="runner-error">{error}</div>}
          <button
            className="primary-button"
            disabled={busy || !retryPrompt.trim()}
            onClick={async () => {
              if (
                run &&
                stage &&
                (await action(`/runs/${run.id}/retry`, {
                  stageId: stage.id,
                  prompt: retryPrompt,
                }))
              ) {
                setRetry(false);
                selectStage(stage.id, '');
                setTab('conversation');
              }
            }}
          >
            <RotateCcw size={15} /> Новая попытка
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
