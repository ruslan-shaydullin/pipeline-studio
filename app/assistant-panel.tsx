'use client';
import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Loader2,
  Search,
  Sparkles,
  Square,
  Undo2,
} from 'lucide-react';
import type { Pipeline } from '@/lib/pipeline';
import { pipelineFingerprint } from '@/lib/advisor.mjs';
import { runnerAction, type RunnerState } from '@/lib/use-runner';
import { flushWorkspace, refreshWorkspace } from '@/lib/use-workspace';
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

export function PipelineAssistant({
  open,
  onOpenChange,
  pipeline,
  runner,
  locked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  runner: RunnerState & { online: boolean };
  locked: boolean;
}) {
  const review = runner.reviews?.find((r) => r.pipelineId === pipeline.id);
  const recent = runner.runs.find(
    (r) => r.pipelineId === pipeline.id && r.status === 'done',
  );
  const [goal, setGoal] = useState(
    pipeline.task || review?.goal || recent?.task || '',
  );
  const [guidance, setGuidance] = useState(review?.guidance || '');
  const [model, setModel] = useState('default');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [operation, setOperation] = useState<{
    signature: string;
    id: string;
  } | null>(null);
  const running = review?.status === 'running';
  const stale =
    review &&
    pipelineFingerprint(review.snapshot) !== pipelineFingerprint(pipeline);
  const changedGoal =
    review && (goal.trim() !== review.goal || guidance !== review.guidance);
  const result = review?.result;
  async function analyze() {
    setBusy(true);
    setError('');
    try {
      await flushWorkspace();
      const value = {
        pipelineId: pipeline.id,
        expectedPipeline: pipelineFingerprint(pipeline),
        goal: goal.trim(),
        guidance,
        model: model === 'default' ? '' : model,
      };
      const signature = JSON.stringify(value);
      const request =
        operation?.signature === signature
          ? operation
          : { signature, id: crypto.randomUUID() };
      setOperation(request);
      await runnerAction('/reviews', { ...value, mutationId: request.id });
      setOperation(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: 'apply' | 'undo' | 'cancel') {
    if (!review) return;
    setBusy(true);
    setError('');
    try {
      await flushWorkspace();
      await runnerAction(`/reviews/${review.id}/${kind}`);
      if (kind !== 'cancel') await refreshWorkspace();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    ready: 'План закрывает цель',
    needs_changes: 'План стоит доработать',
    blocked: 'Есть препятствия для выполнения',
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pipeline-assistant">
        <DialogHeader className="advisor-header">
          <span className="advisor-eyebrow">
            <Sparkles size={15} />
            Помощник · {pipeline.name}
          </span>
          <DialogTitle>Доведём пайплайн до цели</DialogTitle>
          <DialogDescription>
            Глубокий разбор инструкций, передачи контекста и последних запусков.
            Изменения применяются после просмотра.
          </DialogDescription>
        </DialogHeader>
        <div className="advisor-scroll">
          <section className="advisor-brief">
            <label className="run-field">
              Что должно получиться в итоге?
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                maxLength={30000}
                placeholder="Конкретный результат, ограничения и критерии готовности"
                disabled={running || busy}
              />
            </label>
            <details className="advisor-options">
              <summary>Уточнить задачу помощнику</summary>
              <label className="run-field">
                На что обратить внимание
                <textarea
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                  rows={3}
                  maxLength={20000}
                  placeholder="Например: сократить ручные вмешательства и не повторять поиск при продолжении"
                  disabled={running || busy}
                />
              </label>
              <label className="run-field" htmlFor="advisor-model">
                Модель
              </label>
              <Select
                value={model}
                disabled={running || busy}
                onValueChange={(v) => setModel(String(v))}
              >
                <SelectTrigger id="advisor-model">
                  <SelectValue>
                    {model === 'default'
                      ? 'По умолчанию в Codex'
                      : runner.models.find((m) => m.id === model)?.name ||
                        model}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">По умолчанию в Codex</SelectItem>
                  {runner.models.map((m) => (
                    <SelectItem value={m.id} key={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </details>
            <div className="advisor-actions">
              <span>
                <Search size={14} />
                {pipeline.stages.length} этапов · до 3 последних запусков ·
                глубокое рассуждение
              </span>
              {running ? (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void action('cancel')}
                >
                  <Square size={13} />
                  Остановить разбор
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    locked ||
                    !runner.online ||
                    !runner.connected ||
                    !runner.advisorAvailable ||
                    !goal.trim()
                  }
                  onClick={() => void analyze()}
                >
                  {busy ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    <Sparkles size={15} />
                  )}{' '}
                  {result ? 'Разобрать заново' : 'Глубоко проверить'}
                </button>
              )}
            </div>
            {!runner.advisorAvailable && (
              <p className="field-hint">
                Помощник появится после обновления локального исполнителя.
              </p>
            )}
          </section>
          {error && (
            <p className="runner-error" role="alert">
              {error}
            </p>
          )}
          {running && (
            <section className="advisor-progress" aria-live="polite">
              <Loader2 className="spin" size={18} />
              <div>
                <strong>Изучаю, как этапы приводят к результату</strong>
                <p>
                  {review.progress.at(-1) ||
                    'Сопоставляю цель с промптами, историей и возможностями исполнителя. Обычно это занимает несколько минут.'}
                </p>
              </div>
            </section>
          )}
          {review?.status === 'failed' && (
            <p className="runner-error" role="alert">
              {review.error}
            </p>
          )}
          {review?.status === 'cancelled' && (
            <p className="field-hint">Разбор остановлен. Джоба не менялась.</p>
          )}
          {result && (
            <>
              <section className="advisor-verdict">
                <span className={'advisor-verdict-label ' + result.verdict}>
                  {labels[result.verdict]}
                </span>
                <p>{result.summary}</p>
                <small>
                  Изучены промпты и сводки {review.historyCount} запусков. Код и
                  внешние репозитории не проверялись.
                </small>
              </section>
              {result.findings.length > 0 && (
                <section className="advisor-findings">
                  <h3>Что мешает результату</h3>
                  {result.findings.map((f, i) => (
                    <article
                      key={i}
                      className={'advisor-finding ' + f.severity}
                    >
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        <h4>{f.title}</h4>
                        <p>{f.evidence}</p>
                        <p className="advisor-recommendation">
                          <ArrowRight size={13} />
                          {f.recommendation}
                        </p>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {result.assumptions.length > 0 && (
                <section className="advisor-assumptions">
                  <h3>Что нужно уточнить</h3>
                  <ul>
                    {result.assumptions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="advisor-proposal">
                <div className="advisor-section-title">
                  <h3>Предлагаемый пайплайн</h3>
                  <span>{result.proposal.stages.length} этапов</span>
                </div>
                <p className="advisor-proposed-goal">{result.proposal.task}</p>
                {result.proposal.stages.map((s, i) => {
                  const previous = review.snapshot.stages.find(
                    (p) => p.id === s.sourceId,
                  );
                  const changed =
                    previous?.prompt !== s.prompt ||
                    !!previous?.allowStageCreation !== s.allowStageCreation ||
                    previous?.name !== s.name;
                  return (
                    <details key={i} className="advisor-stage">
                      <summary>
                        <span className="advisor-stage-number">{i + 1}</span>
                        <strong>{s.name}</strong>
                        <small>
                          {!s.sourceId
                            ? 'Новый'
                            : changed
                              ? 'Изменён'
                              : review.snapshot.stages.findIndex(
                                    (p) => p.id === s.sourceId,
                                  ) !== i
                                ? 'Перемещён'
                                : 'Без изменений'}
                        </small>
                      </summary>
                      <p>{s.reason}</p>
                      <div className="advisor-prompt">
                        <span>
                          Новая инструкция
                          {s.allowStageCreation
                            ? ' · может создавать этапы'
                            : ''}
                        </span>
                        <pre>{s.prompt}</pre>
                      </div>
                      {previous && changed && (
                        <details className="advisor-old-prompt">
                          <summary>Предыдущая инструкция</summary>
                          <pre>{previous.prompt}</pre>
                        </details>
                      )}
                    </details>
                  );
                })}
                {review.snapshot.stages
                  .filter(
                    (s) =>
                      !result.proposal.stages.some((p) => p.sourceId === s.id),
                  )
                  .map((s) => (
                    <p className="advisor-removed" key={s.id}>
                      Убрать этап: {s.name}
                    </p>
                  ))}
              </section>
              <div className="advisor-apply">
                {review.status === 'applied' ? (
                  <>
                    <p>
                      <Check size={15} />
                      Предложение сохранено в джобе. История запусков сохранена.
                    </p>
                    <button
                      className="secondary-button"
                      disabled={busy || locked}
                      onClick={() => void action('undo')}
                    >
                      <Undo2 size={14} />
                      Отменить применение
                    </button>
                  </>
                ) : review.status === 'reverted' ? (
                  <p>
                    Применение отменено. Для новых изменений запусти разбор
                    заново.
                  </p>
                ) : (
                  <>
                    <p>
                      {stale
                        ? 'Джоба изменилась после разбора. Повтори анализ, чтобы не затереть правки.'
                        : changedGoal
                          ? 'Цель или пожелания изменены. Запусти разбор заново.'
                          : 'Заменит цель и этапы этой джобы. Запуски и права доступа сохранятся; применение можно отменить.'}
                    </p>
                    <button
                      className="primary-button"
                      disabled={
                        busy || locked || stale || changedGoal || !runner.online
                      }
                      onClick={() => void action('apply')}
                    >
                      {busy ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <Check size={15} />
                      )}
                      Применить к джобе
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
