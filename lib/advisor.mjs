import { normalizeAccessMode } from './access.mjs';

export function pipelineFingerprint(pipeline) {
  return JSON.stringify({
    id: pipeline.id,
    folderId: pipeline.folderId,
    name: pipeline.name,
    description: pipeline.description,
    task: pipeline.task,
    accessMode: normalizeAccessMode(pipeline.accessMode),
    stages: pipeline.stages.map((s) => ({
      id: s.id,
      name: s.name,
      prompt: s.prompt,
      agent: s.agent,
      appearance: s.appearance ?? 0,
      allowStageCreation: !!s.allowStageCreation,
    })),
  });
}

export const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['ready', 'needs_changes', 'blocked'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: {
            type: 'string',
            enum: ['critical', 'important', 'suggestion'],
          },
          stageIds: { type: 'array', items: { type: 'string' } },
          title: { type: 'string' },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
        },
        required: [
          'severity',
          'stageIds',
          'title',
          'evidence',
          'recommendation',
        ],
      },
    },
    assumptions: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    proposal: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: { type: 'string' },
        description: { type: 'string' },
        stages: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sourceId: { type: ['string', 'null'] },
              name: { type: 'string' },
              prompt: { type: 'string' },
              allowStageCreation: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: [
              'sourceId',
              'name',
              'prompt',
              'allowStageCreation',
              'reason',
            ],
          },
        },
      },
      required: ['task', 'description', 'stages'],
    },
  },
  required: ['verdict', 'summary', 'findings', 'assumptions', 'proposal'],
};
function text(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max;
}
export function validateReviewResult(value, pipeline) {
  if (
    !value ||
    !['ready', 'needs_changes', 'blocked'].includes(value.verdict) ||
    !text(value.summary, 12000) ||
    !Array.isArray(value.findings) ||
    value.findings.length > 12 ||
    !Array.isArray(value.assumptions) ||
    value.assumptions.length > 10 ||
    value.assumptions.some((s) => !text(s, 5000))
  )
    throw new Error('Помощник вернул неполный разбор');
  const ids = new Set(pipeline.stages.map((s) => s.id));
  for (const f of value.findings)
    if (
      !['critical', 'important', 'suggestion'].includes(f.severity) ||
      !text(f.title, 300) ||
      !text(f.evidence, 8000) ||
      !text(f.recommendation, 8000) ||
      !Array.isArray(f.stageIds) ||
      f.stageIds.some((id) => !ids.has(id))
    )
      throw new Error('Замечания помощника не соответствуют этапам');
  const p = value.proposal;
  if (
    !p ||
    Object.keys(p).some(
      (k) => !['task', 'description', 'stages'].includes(k),
    ) ||
    !text(p.task, 30000) ||
    typeof p.description !== 'string' ||
    p.description.length > 5000 ||
    !Array.isArray(p.stages) ||
    p.stages.length < 1 ||
    p.stages.length > 50
  )
    throw new Error('Предложенный пайплайн не прошёл проверку');
  const used = new Set();
  for (const s of p.stages) {
    if (
      !s ||
      Object.keys(s).some(
        (k) =>
          ![
            'sourceId',
            'name',
            'prompt',
            'allowStageCreation',
            'reason',
          ].includes(k),
      ) ||
      !(
        s.sourceId === null ||
        (ids.has(s.sourceId) && !used.has(s.sourceId))
      ) ||
      !text(s.name, 160) ||
      !text(s.prompt, 30000) ||
      !text(s.reason, 8000) ||
      typeof s.allowStageCreation !== 'boolean'
    )
      throw new Error(
        'Предложение содержит некорректный или повторяющийся этап',
      );
    if (s.sourceId) used.add(s.sourceId);
  }
  if (JSON.stringify(value).length > 200000)
    throw new Error('Предложение слишком большое');
  return value;
}
export function proposedPipeline(pipeline, result, makeId) {
  validateReviewResult(result, pipeline);
  return {
    ...pipeline,
    task: result.proposal.task,
    description: result.proposal.description,
    stages: result.proposal.stages.map((s, i) => {
      const old = pipeline.stages.find((p) => p.id === s.sourceId);
      return {
        id: old?.id || makeId(),
        name: s.name,
        prompt: s.prompt,
        agent: old?.agent || 'codex',
        appearance: old?.appearance ?? i % 4,
        allowStageCreation: s.allowStageCreation,
      };
    }),
  };
}
