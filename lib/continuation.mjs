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

/** Completed results remain a valid starting point even when the template changed. */
export function canContinueRun(run, pipelineId = run.pipelineId) {
  return (
    run.pipelineId === pipelineId &&
    run.status === 'done' &&
    run.cursor === run.stages.length &&
    run.stages.length > 0 &&
    run.stages.every((s) => {
      const a = s.attempts.find((a) => a.id === s.activeAttemptId);
      return (
        ['done', 'skipped'].includes(s.status) &&
        a?.cwd &&
        ['done', 'skipped'].includes(a.status) &&
        ['done', 'skipped'].includes(a.outcome?.status)
      );
    })
  );
}

export function templatePrompt(stage) {
  return stage.templatePrompt ?? stage.attempts?.[0]?.prompt ?? stage.prompt;
}

/** A manual next step continues the run's saved plan, independently of later template edits. */
export function manualContinuation(run, pipeline, next) {
  return {
    ...pipeline,
    stages: [
      ...run.stages
        .filter((s) => !s.generatedBy && !s.addedManually)
        .map((s) => ({
          id: s.id,
          name: s.name,
          prompt: templatePrompt(s),
          agent: s.agent || 'codex',
          appearance: s.appearance,
          allowStageCreation: !!s.allowStageCreation,
        })),
      next,
    ],
  };
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
    changes: [],
  });
  if (run.pipelineId !== pipeline.id)
    return unavailable('Это запуск другой джобы');
  if (!canContinueRun(run, pipeline.id))
    return unavailable('Сначала заверши текущие этапы');
  const fixed = run.stages.filter((s) => !s.generatedBy && !s.addedManually);
  if (fixed.some((s, i) => pipeline.stages[i]?.id !== s.id))
    return unavailable(
      'Порядок этапов изменился. Опиши самостоятельный следующий шаг для сохранённого результата',
    );
  const added = pipeline.stages.slice(fixed.length);
  const agent = (value) => (!value || value === 'default' ? 'codex' : value);
  const changes = fixed
    .filter(
      (s, i) =>
        pipeline.stages[i].prompt !== templatePrompt(s) ||
        !!pipeline.stages[i].allowStageCreation !== !!s.allowStageCreation ||
        agent(pipeline.stages[i].agent) !== agent(s.agent),
    )
    .map((s) => ({ id: s.id, name: s.name }));
  const plan = {
    eligible: true,
    reason: '',
    reused: run.stages,
    added,
    changes,
  };
  if (!added.length)
    return {
      ...plan,
      eligible: false,
      reason: 'Опиши следующий шаг, чтобы продолжить готовый результат',
    };
  if (run.stages.length + added.length > 50)
    return {
      ...plan,
      eligible: false,
      reason: 'В запуске может быть не больше 50 этапов',
    };
  const existing = new Set(
    [...run.stages, ...(run.archivedStages || [])].map((s) => s.id),
  );
  if (
    added.some((s) => existing.has(s.id)) ||
    new Set(added.map((s) => s.id)).size !== added.length
  )
    return {
      ...plan,
      eligible: false,
      reason: 'Идентификаторы новых этапов должны различаться',
    };
  if (added.some((s) => !s.prompt.trim()))
    return {
      ...plan,
      eligible: false,
      reason: 'Добавь инструкцию для каждого нового этапа',
    };
  return plan;
}

/** Reopening a job should show its most recently continued run. */
export function recentRun(runs) {
  return runs.reduce((latest, run) => {
    const time = (r) => Date.parse(r.continuations?.at(-1)?.at || r.createdAt);
    return !latest || time(run) > time(latest) ? run : latest;
  }, undefined);
}
