/** A stable snapshot token prevents an old preview from extending a changed run. */
export function continuationToken(run) {
  return JSON.stringify({
    id: run.id,
    generation: run.generation || 0,
    status: run.status,
    cursor: run.cursor,
    task: run.task,
    accessMode: run.accessMode || 'supervised',
    stages: run.stages.map((s) => [
      s.id,
      s.prompt,
      s.status,
      s.activeAttemptId,
      s.templatePrompt,
    ]),
  });
}

/**
 * @param {import('./use-runner').AgentRun} run
 * @param {import('./pipeline').Pipeline} pipeline
 */
export function continuationPlan(run, pipeline) {
  const unavailable = (reason) => ({
    eligible: false,
    reason,
    reused: [],
    added: [],
  });
  if (run.pipelineId !== pipeline.id)
    return unavailable('Это запуск другой джобы');
  if (run.status !== 'done' || run.cursor !== run.stages.length)
    return unavailable('Сначала заверши текущие этапы');
  if (
    !run.stages.length ||
    run.stages.some((s) => {
      const a = s.attempts.find((a) => a.id === s.activeAttemptId);
      return (
        !['done', 'skipped'].includes(s.status) ||
        !a?.outcome ||
        !['done', 'skipped'].includes(a.status) ||
        !['done', 'skipped'].includes(a.outcome.status) ||
        !a.cwd
      );
    })
  )
    return unavailable('Не у всех этапов сохранён завершённый результат');
  const fixed = run.stages.filter((s) => !s.generatedBy);
  if (pipeline.stages.length <= fixed.length)
    return unavailable('Новых этапов в конце джобы пока нет');
  if (
    fixed.some(
      (s, i) =>
        pipeline.stages[i]?.id !== s.id ||
        pipeline.stages[i]?.prompt !== (s.templatePrompt ?? s.prompt) ||
        !!pipeline.stages[i]?.allowStageCreation !== !!s.allowStageCreation ||
        (pipeline.stages[i]?.agent === 'default'
          ? 'codex'
          : pipeline.stages[i]?.agent) !==
          (s.agent === 'default' ? 'codex' : s.agent || 'codex'),
    )
  )
    return unavailable(
      'Порядок или промпты выполненных этапов изменились. Верни их, чтобы продолжить этот результат',
    );
  const added = pipeline.stages.slice(fixed.length);
  if (run.stages.length + added.length > 50)
    return unavailable('В запуске может быть не больше 50 этапов');
  const existing = new Set(
    [...run.stages, ...(run.archivedStages || [])].map((s) => s.id),
  );
  if (
    added.some((s) => existing.has(s.id)) ||
    new Set(added.map((s) => s.id)).size !== added.length
  )
    return unavailable('Идентификаторы новых этапов должны различаться');
  if (added.some((s) => !s.prompt.trim()))
    return unavailable('Добавь инструкцию для каждого нового этапа');
  return { eligible: true, reason: '', reused: run.stages, added };
}

/** Reopening a job should show its most recently continued run. */
export function recentRun(runs) {
  return runs.reduce((latest, run) => {
    const time = (r) => Date.parse(r.continuations?.at(-1)?.at || r.createdAt);
    return !latest || time(run) > time(latest) ? run : latest;
  }, undefined);
}
