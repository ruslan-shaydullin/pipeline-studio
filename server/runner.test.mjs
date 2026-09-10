import test from 'node:test';
import {
  continuationPlan,
  continuationToken,
  recentRun,
} from '../lib/continuation.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Runner,
  parseOutcome,
  validateJob,
  copyWorkspace,
  validateExpansion,
} from './runner.mjs';

class FakeCodex extends EventEmitter {
  calls = [];
  counter = 0;
  replies = [];
  async connect() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'model/list') return { data: [] };
    if (method === 'thread/start')
      return { thread: { id: `thread-${++this.counter}` }, model: 'test' };
    if (method === 'turn/start')
      return { turn: { id: `turn-${++this.counter}` } };
    return {};
  }
  reply(id, result) {
    this.replies.push({ id, result });
  }
  reject(id, error) {
    this.replies.push({ id, error });
  }
  close() {}
}
const job = () => ({
  pipelineId: 'job',
  name: 'Job',
  task: 'Fix the issue',
  stages: ['Plan', 'Implement'].map((name, i) => ({
    id: `stage-${i}`,
    name,
    prompt: 'Do the stage',
    agent: 'codex',
  })),
});
async function fixture(t, dataDir) {
  const dir = dataDir || (await mkdtemp(path.join(tmpdir(), 'pipeline-test-')));
  const client = new FakeCodex();
  const runner = new Runner({
    client,
    dataDir: dir,
    prepareWorkspace: async (_, dest) => mkdir(dest, { recursive: true }),
    initWorkspace: async () => {},
    diffWorkspace: async () => 'diff',
  });
  await runner.connect();
  t.after(async () => {
    runner.shutdown();
    if (!dataDir) await rm(dir, { recursive: true, force: true });
  });
  return { runner, client, dir };
}
async function settle(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('State did not settle');
}
async function complete(runner, attempt, status = 'done', extra = {}) {
  const params = { threadId: attempt.threadId, turnId: attempt.turnId };
  await runner.onNotification({
    method: 'item/completed',
    params: {
      ...params,
      item: {
        id: `message-${attempt.turnId}`,
        type: 'agentMessage',
        phase: 'final_answer',
        text: JSON.stringify({
          status,
          summary: 'Summary',
          handoff: 'Handoff from this attempt',
          artifacts: [],
          ...extra,
        }),
      },
    },
  });
  await runner.onNotification({
    method: 'turn/completed',
    params: { ...params, turn: { id: attempt.turnId, status: 'completed' } },
  });
}
test('success hands context to a distinct session exactly once, including duplicate completion', async (t) => {
  const { runner, client } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const first = runner.current(run);
  await complete(runner, first);
  await settle(
    () => run.cursor === 1 && runner.current(run)?.turnId && !runner.busy,
  );
  await runner.onNotification({
    method: 'turn/completed',
    params: {
      threadId: first.threadId,
      turn: { id: first.turnId, status: 'completed' },
    },
  });
  const second = runner.current(run);
  assert.notEqual(first.threadId, second.threadId);
  assert.match(second.input, /Handoff from this attempt/);
  assert.equal(
    client.calls.filter((c) => c.method === 'thread/start').length,
    2,
  );
  await complete(runner, second);
  assert.equal(run.status, 'done');
});
test('malformed result fails instead of advancing on assistant text', async (t) => {
  const { runner } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const a = runner.current(run);
  await runner.onNotification({
    method: 'item/completed',
    params: {
      threadId: a.threadId,
      item: {
        id: 'bad',
        type: 'agentMessage',
        phase: 'final_answer',
        text: 'I am done',
      },
    },
  });
  await runner.onNotification({
    method: 'turn/completed',
    params: {
      threadId: a.threadId,
      turn: { id: a.turnId, status: 'completed' },
    },
  });
  assert.equal(run.status, 'failed');
  assert.equal(run.stages[1].attempts.length, 0);
});
test('needs_input waits; reply resumes the same attempt and thread; steer does not create a new thread', async (t) => {
  const { runner, client } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const a = runner.current(run);
  await complete(runner, a, 'needs_input');
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.stages[1].attempts.length, 0);
  await runner.message(run.id, a.id, 'Clarification');
  assert.equal(runner.current(run).id, a.id);
  assert.equal(
    client.calls.filter((c) => c.method === 'thread/start').length,
    1,
  );
  await runner.message(run.id, a.id, 'Additional direction');
  assert.equal(client.calls.at(-1).method, 'turn/steer');
  assert.equal(client.calls.at(-1).params.expectedTurnId, a.turnId);
  await complete(runner, a);
  await settle(() => run.cursor === 1);
});
test('approval is pending until explicit answer, then returns to running', async (t) => {
  const { runner, client } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const a = runner.current(run);
  runner.onRequest({
    id: 99,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: a.threadId, command: 'npm test' },
  });
  assert.equal(run.status, 'waiting_approval');
  await assert.rejects(runner.message(run.id, a.id, 'Go'), /Сначала ответь/);
  await runner.answer(run.id, a.id, 99, { decision: 'decline' });
  assert.deepEqual(client.replies[0], {
    id: 99,
    result: { decision: 'decline' },
  });
  assert.equal(run.status, 'running');
  await assert.rejects(
    runner.answer(run.id, a.id, 99, { decision: 'accept' }),
    /закрыт/,
  );
});
test('stop is idempotent and late success never advances stopped run', async (t) => {
  const { runner, client } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const a = runner.current(run);
  await runner.stop(run.id);
  await runner.stop(run.id);
  await complete(runner, a);
  assert.equal(run.status, 'stopped');
  assert.equal(run.stages[1].attempts.length, 0);
  assert.equal(
    client.calls.filter((c) => c.method === 'turn/interrupt').length,
    1,
  );
});
test('retry preserves past attempts, invalidates downstream and rejects duplicate retry', async (t) => {
  const { runner } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const first = runner.current(run);
  await complete(runner, first);
  await settle(
    () => run.cursor === 1 && runner.current(run)?.turnId && !runner.busy,
  );
  const second = runner.current(run);
  await complete(runner, second);
  runner.retry(run.id, run.stages[0].id, 'New prompt');
  assert.equal(run.stages[1].activeAttemptId, null);
  assert.equal(run.stages[1].status, 'idle');
  assert.equal(run.stages[1].attempts[0].id, second.id);
  assert.equal(second.status, 'done');
  assert.throws(
    () => runner.retry(run.id, run.stages[0].id, 'Again'),
    /Сначала останови/,
  );
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  assert.notEqual(runner.current(run).id, first.id);
  assert.equal(first.prompt, 'Do the stage');
  await assert.rejects(
    runner.message(run.id, first.id, 'Wrong attempt'),
    /только для чтения/,
  );
});
test('restart preserves history and marks in-flight attempt stopped without replaying work', async (t) => {
  const first = await fixture(t);
  const run = await first.runner.create(job());
  await settle(() => first.runner.current(run)?.turnId && !first.runner.busy);
  const thread = first.runner.current(run).threadId;
  first.runner.flush();
  const second = { client: new FakeCodex() };
  second.runner = new Runner({ client: second.client, dataDir: first.dir });
  const restored = second.runner.find(run.id);
  assert.equal(restored.status, 'stopped');
  assert.equal(second.runner.current(restored).threadId, thread);
  assert.equal(
    second.client.calls.filter((c) => c.method === 'thread/start').length,
    0,
  );
  second.runner.shutdown();
});
test('validates job contract and final outcome status', () => {
  assert.throws(() =>
    validateJob({
      ...job(),
      stages: [{ ...job().stages[0], agent: 'claude' }],
    }),
  );
  assert.throws(() => parseOutcome('{"status":"done","summary":"ok"}'));
});
test('stop and retry during workspace preparation cannot launch the abandoned attempt', async (t) => {
  const { runner, client } = await fixture(t);
  let release;
  let copies = 0;
  runner.prepareWorkspace = async () => {
    if (++copies === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
  };
  const run = await runner.create(job());
  const abandoned = runner.current(run);
  await runner.stop(run.id);
  runner.retry(run.id, run.stages[0].id, 'Retry');
  release();
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  assert.equal(abandoned.threadId, null);
  assert.equal(client.calls.filter((c) => c.method === 'turn/start').length, 1);
  assert.notEqual(runner.current(run).id, abandoned.id);
});
test('stop while resuming a thread cannot resurrect the stopped run', async (t) => {
  const { runner, client } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const a = runner.current(run);
  await complete(runner, a, 'needs_input');
  const request = client.request.bind(client);
  let release;
  client.request = async (method, params) => {
    if (method === 'thread/resume')
      await new Promise((resolve) => {
        release = resolve;
      });
    return request(method, params);
  };
  const message = runner.message(run.id, a.id, 'Continue');
  await runner.stop(run.id);
  release();
  await message;
  assert.equal(run.status, 'stopped');
  assert.equal(client.calls.filter((c) => c.method === 'turn/start').length, 1);
});
test('completion awaiting a diff cannot complete a newer turn', async (t) => {
  const { runner } = await fixture(t);
  const run = await runner.create(job());
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const a = runner.current(run);
  let release;
  runner.diffWorkspace = () =>
    new Promise((resolve) => {
      release = () => resolve('old diff');
    });
  const completion = complete(runner, a);
  await settle(() => !!release);
  await runner.stop(run.id);
  await runner.message(run.id, a.id, 'New direction');
  release();
  await completion;
  assert.equal(run.status, 'running');
  assert.equal(run.cursor, 0);
  assert.equal(a.outcome, null);
});
test('handoff preserves a generated dist artifact while source copy excludes it', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pipeline-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  await mkdir(path.join(source, 'dist'), { recursive: true });
  await writeFile(path.join(source, 'dist/report.html'), 'report');
  await copyWorkspace(source, path.join(dir, 'input'));
  await assert.rejects(readFile(path.join(dir, 'input/dist/report.html')));
  await copyWorkspace(source, path.join(dir, 'handoff'), { handoff: true });
  assert.equal(
    await readFile(path.join(dir, 'handoff/dist/report.html'), 'utf8'),
    'report',
  );
});
const plan = [
  { name: 'Implement generated', prompt: 'Implement only' },
  { name: 'Test generated', prompt: 'Test only' },
];
const planningJob = () => {
  const input = job();
  input.stages[0].allowStageCreation = true;
  return input;
};
async function ready(runner, run, index) {
  await settle(
    () => run.cursor === index && runner.current(run)?.turnId && !runner.busy,
  );
  return runner.current(run);
}
test('planner inserts once before fixed stages, handing context into distinct generated sessions', async (t) => {
  const { runner, client } = await fixture(t);
  const run = await runner.create(planningJob());
  const planner = await ready(runner, run, 0);
  assert.ok(
    client.calls.find((c) => c.method === 'turn/start').params.outputSchema
      .properties.nextStages,
  );
  await complete(runner, planner, 'done', { nextStages: plan });
  const first = await ready(runner, run, 1);
  assert.deepEqual(
    run.stages.map((s) => s.name),
    ['Plan', ...plan.map((s) => s.name), 'Implement'],
  );
  assert.deepEqual(run.stages[1].generatedBy, {
    stageId: 'stage-0',
    attemptId: planner.id,
  });
  assert.equal(run.stages[1].allowStageCreation, false);
  assert.match(first.input, /Handoff from this attempt/);
  await complete(runner, planner, 'done', { nextStages: plan });
  assert.equal(run.stages.length, 4);
  await complete(runner, first);
  await complete(runner, await ready(runner, run, 2));
  await complete(runner, await ready(runner, run, 3));
  assert.equal(run.status, 'done');
  assert.equal(new Set(run.stages.map((s) => s.attempts[0].threadId)).size, 4);
});
test('retrying planner archives generated attempts, persists history and generates fresh IDs', async (t) => {
  const { runner, dir } = await fixture(t);
  const run = await runner.create(planningJob());
  await complete(runner, await ready(runner, run, 0), 'done', {
    nextStages: plan,
  });
  await complete(runner, await ready(runner, run, 1));
  await complete(runner, await ready(runner, run, 2));
  await complete(runner, await ready(runner, run, 3));
  const old = run.stages.slice(1, 3);
  const fixedAttempt = run.stages[3].attempts[0];
  runner.retry(run.id, 'stage-0', 'Plan again');
  const planner = await ready(runner, run, 0);
  assert.deepEqual(
    run.archivedStages.map((s) => s.id),
    old.map((s) => s.id),
  );
  assert.ok(
    run.archivedStages.every((s) => s.archivedAt && s.attempts[0].threadId),
  );
  assert.equal(run.stages[1].attempts[0].id, fixedAttempt.id);
  await complete(runner, planner, 'done', { nextStages: plan.slice(0, 1) });
  await ready(runner, run, 1);
  assert.ok(!old.some((s) => s.id === run.stages[1].id));
  const before = run.stages.length;
  await complete(runner, old[0].attempts[0]);
  assert.equal(run.stages.length, before);
  await runner.stop(run.id);
  runner.shutdown();
  const restored = new Runner({ client: new FakeCodex(), dataDir: dir });
  assert.equal(
    restored.find(run.id).archivedStages[0].attempts[0].threadId,
    old[0].attempts[0].threadId,
  );
  restored.shutdown();
});
test('retrying generated stage retains its siblings and their attempt history', async (t) => {
  const { runner } = await fixture(t);
  const run = await runner.create(planningJob());
  await complete(runner, await ready(runner, run, 0), 'done', {
    nextStages: plan,
  });
  await complete(runner, await ready(runner, run, 1));
  await complete(runner, await ready(runner, run, 2));
  await complete(runner, await ready(runner, run, 3));
  const ids = run.stages.map((s) => s.id);
  runner.retry(run.id, ids[1], 'Try generated again');
  await ready(runner, run, 1);
  assert.deepEqual(
    run.stages.map((s) => s.id),
    ids,
  );
  assert.equal(run.archivedStages.length, 0);
  assert.equal(run.stages[2].attempts.length, 1);
});
test('planner can wait for input then expand once in the same session', async (t) => {
  const { runner } = await fixture(t);
  const run = await runner.create(planningJob());
  const a = await ready(runner, run, 0);
  const thread = a.threadId;
  await complete(runner, a, 'needs_input', { nextStages: [] });
  assert.equal(run.stages.length, 2);
  await runner.message(run.id, a.id, 'Proceed');
  assert.equal(a.threadId, thread);
  await complete(runner, a, 'done', { nextStages: plan });
  await ready(runner, run, 1);
  assert.equal(run.stages.length, 4);
  assert.equal(a.expansion.stageIds.length, 2);
});
test('invalid expansion fails atomically; unprivileged and recursive generation are rejected', async (t) => {
  const { runner } = await fixture(t);
  const run = await runner.create(planningJob());
  await complete(runner, await ready(runner, run, 0), 'done', {
    nextStages: [plan[0], { name: 'Bad', prompt: '' }],
  });
  assert.equal(run.status, 'failed');
  assert.equal(run.stages.length, 2);
  const outcome = { status: 'done', nextStages: plan };
  assert.throws(() => validateExpansion(outcome, {}, run), /разрешённый/);
  assert.throws(
    () =>
      validateExpansion(
        outcome,
        { allowStageCreation: true, generatedBy: {} },
        run,
      ),
    /разрешённый/,
  );
  assert.throws(
    () =>
      validateExpansion(
        { ...outcome, nextStages: Array(6).fill(plan[0]) },
        { allowStageCreation: true },
        run,
      ),
    /0 до 5/,
  );
  assert.throws(
    () =>
      validateExpansion(
        outcome,
        { allowStageCreation: true },
        { stages: Array(49).fill({}) },
      ),
    /50/,
  );
});
test('resumed turn without its own final cannot reuse an earlier plan', async (t) => {
  const { runner } = await fixture(t);
  const run = await runner.create(planningJob());
  const a = await ready(runner, run, 0);
  await complete(runner, a, 'done', {
    nextStages: [{ name: 'Invalid', prompt: '' }],
  });
  assert.equal(run.status, 'failed');
  await runner.message(run.id, a.id, 'Try again');
  await runner.onNotification({
    method: 'turn/completed',
    params: {
      threadId: a.threadId,
      turn: { id: a.turnId, status: 'completed' },
    },
  });
  assert.equal(run.status, 'failed');
  assert.equal(run.stages.length, 2);
  assert.equal(a.outcome, null);
  assert.equal(a.expansion, undefined);
});
function extension(run, stages, mutationId = 'extend-test') {
  return {
    mutationId,
    expectedState: continuationToken(run),
    pipeline: {
      id: run.pipelineId,
      name: run.name,
      task: 'Different template task',
      stages,
    },
  };
}
async function oneStageDone(t) {
  const f = await fixture(t);
  const input = job();
  input.stages = input.stages.slice(0, 1);
  const run = await f.runner.create(input);
  const first = await ready(f.runner, run, 0);
  await complete(f.runner, first);
  return { ...f, run, first, input };
}
test('append a stage to a completed run reuses the original session, files and handoff', async (t) => {
  const { runner, client, run, first, input } = await oneStageDone(t);
  await writeFile(path.join(first.cwd, 'candidates.md'), 'Existing candidates');
  runner.prepareWorkspace = copyWorkspace;
  const snapshot = structuredClone(first);
  const request = extension(run, job().stages);
  runner.extend(run.id, request);
  const next = await ready(runner, run, 1);
  assert.deepEqual(run.stages[0].attempts[0], snapshot);
  assert.equal(
    await readFile(path.join(next.cwd, 'candidates.md'), 'utf8'),
    'Existing candidates',
  );
  assert.match(next.input, /Handoff from this attempt/);
  assert.equal(run.task, input.task);
  assert.notEqual(first.threadId, next.threadId);
  runner.extend(run.id, request);
  assert.equal(run.stages.length, 2);
  await complete(runner, next);
  runner.extend(run.id, request);
  assert.equal(run.status, 'done');
  assert.equal(
    client.calls.filter((c) => c.method === 'thread/start').length,
    2,
  );
  assert.equal(run.continuations.length, 1);
});
test('stale or conflicting continuation previews cannot change a completed prefix', async (t) => {
  const { runner, run } = await oneStageDone(t);
  const initial = JSON.stringify(run);
  const changed = job().stages;
  changed[0].prompt = 'Changed task';
  assert.throws(
    () => runner.extend(run.id, extension(run, changed)),
    /Порядок или промпты/,
  );
  const other = extension(run, job().stages);
  other.pipeline.id = 'other';
  assert.throws(() => runner.extend(run.id, other), /другой джобы/);
  assert.throws(
    () => runner.extend(run.id, extension(run, job().stages.slice(0, 1))),
    /Новых этапов/,
  );
  assert.equal(JSON.stringify(run), initial);
  const first = extension(run, job().stages);
  const competing = { ...first, mutationId: 'competing-operation' };
  runner.extend(run.id, first);
  assert.throws(() => runner.extend(run.id, competing), /изменился/);
  assert.throws(
    () =>
      runner.extend(run.id, {
        ...first,
        pipeline: { ...first.pipeline, name: 'Different' },
      }),
    /идентификатор/,
  );
});
test('completed generated stages remain before an appended fixed tail', async (t) => {
  const { runner } = await fixture(t);
  const input = planningJob();
  input.stages = input.stages.slice(0, 1);
  const run = await runner.create(input);
  await complete(runner, await ready(runner, run, 0), 'done', {
    nextStages: plan,
  });
  await complete(runner, await ready(runner, run, 1));
  await complete(runner, await ready(runner, run, 2));
  const previous = run.stages.map((s) => s.id);
  runner.extend(run.id, extension(run, [...input.stages, job().stages[1]]));
  await ready(runner, run, 3);
  assert.deepEqual(
    run.stages.slice(0, 3).map((s) => s.id),
    previous,
  );
  assert.equal(run.stages[3].id, 'stage-1');
  assert.equal(run.stages.slice(0, 3).flatMap((s) => s.attempts).length, 3);
});
test('missing handoff files and stage limit leave the completed run intact', async (t) => {
  const { runner, run, first } = await oneStageDone(t);
  const initial = JSON.stringify(run);
  await rm(first.cwd, { recursive: true });
  assert.throws(
    () => runner.extend(run.id, extension(run, job().stages)),
    /Рабочие файлы/,
  );
  assert.equal(JSON.stringify(run), initial);
  const large = {
    ...run,
    stages: Array.from({ length: 50 }, (_, i) => ({
      ...run.stages[0],
      id: 'large-' + i,
      generatedBy: i ? { stageId: 'large-0' } : undefined,
    })),
    cursor: 50,
  };
  assert.match(
    continuationPlan(large, {
      id: run.pipelineId,
      stages: [{ ...job().stages[0], id: 'large-0' }, job().stages[1]],
    }).reason,
    /50/,
  );
});
test('extension waits behind another active run and never reruns its completed prefix', async (t) => {
  const { runner, run } = await oneStageDone(t);
  const active = await runner.create(job());
  await ready(runner, active, 0);
  runner.extend(run.id, extension(run, job().stages));
  assert.equal(run.status, 'queued');
  assert.equal(run.stages[1].attempts.length, 0);
  await runner.stop(active.id);
  await ready(runner, run, 1);
  assert.equal(run.stages[0].attempts.length, 1);
});
test('extension receipt and reused attempts survive a restart and a retried request', async (t) => {
  const { runner, run, dir } = await oneStageDone(t);
  const request = extension(run, job().stages);
  runner.extend(run.id, request);
  await ready(runner, run, 1);
  await runner.stop(run.id);
  runner.shutdown();
  const restored = new Runner({ client: new FakeCodex(), dataDir: dir });
  restored.extend(run.id, request);
  assert.equal(restored.find(run.id).status, 'stopped');
  assert.equal(restored.find(run.id).stages.length, 2);
  assert.equal(restored.find(run.id).stages[0].attempts.length, 1);
  restored.shutdown();
});
test('run-only prompt overrides do not prevent extending the unchanged job again', async (t) => {
  const { runner, run } = await oneStageDone(t);
  const request = extension(run, job().stages);
  request.overrides = {
    'stage-1': 'Special instruction for this continuation',
  };
  runner.extend(run.id, request);
  const second = await ready(runner, run, 1);
  assert.equal(second.prompt, 'Special instruction for this continuation');
  await complete(runner, second);
  const stages = [
    ...job().stages,
    { id: 'third', name: 'Third', prompt: 'Summarize', agent: 'codex' },
  ];
  assert.equal(
    continuationPlan(run, { id: run.pipelineId, stages }).eligible,
    true,
  );
  runner.extend(run.id, extension(run, stages, 'second-extension'));
  await ready(runner, run, 2);
  assert.equal(run.stages[1].attempts.length, 1);
});
test('changing creation capability or overriding a completed stage cannot reuse silently', async (t) => {
  const { runner, run } = await oneStageDone(t);
  const stages = job().stages;
  stages[0].allowStageCreation = true;
  assert.equal(
    continuationPlan(run, { id: run.pipelineId, stages }).eligible,
    false,
  );
  const request = extension(run, job().stages);
  request.overrides = { 'stage-0': 'Override completed' };
  assert.throws(
    () => runner.extend(run.id, request),
    /только инструкции новых/,
  );
  assert.equal(run.status, 'done');
  assert.equal(run.stages.length, 1);
});

test('reopening a job selects the recently continued run over a newer abandoned run', () => {
  const old = {
    id: 'old',
    createdAt: '2026-09-10T10:00:00Z',
    continuations: [{ at: '2026-09-10T12:00:00Z' }],
  };
  const newer = { id: 'new', createdAt: '2026-09-10T11:00:00Z' };
  assert.equal(recentRun([newer, old]).id, 'old');
  assert.equal(recentRun([]), undefined);
});

for (const accessMode of ['supervised', 'network', 'full']) {
  test(`${accessMode} access is snapshotted and applied to fixed and generated sessions`, async (t) => {
    const { runner, client } = await fixture(t);
    const input = { ...job(), accessMode };
    input.stages[0].allowStageCreation = true;
    const run = await runner.create(input);
    input.accessMode = accessMode === 'full' ? 'supervised' : 'full';
    await settle(() => runner.current(run)?.turnId && !runner.busy);
    const first = runner.current(run);
    await complete(runner, first, 'done', {
      nextStages: [{ name: 'Generated', prompt: 'Inspect the result' }],
    });
    await settle(
      () => run.cursor === 1 && runner.current(run)?.turnId && !runner.busy,
    );
    await complete(runner, runner.current(run));
    await settle(
      () => run.cursor === 2 && runner.current(run)?.turnId && !runner.busy,
    );
    assert.equal(run.accessMode, accessMode);
    for (const stage of run.stages)
      assert.equal(stage.attempts[0].accessMode, accessMode);
    const threads = client.calls.filter(
      (call) => call.method === 'thread/start',
    );
    const turns = client.calls.filter((call) => call.method === 'turn/start');
    assert.equal(threads.length, 3);
    assert.equal(turns.length, 3);
    for (const { params } of threads) {
      assert.equal(
        params.sandbox,
        accessMode === 'full' ? 'danger-full-access' : 'workspace-write',
      );
      assert.equal(
        params.approvalPolicy,
        accessMode === 'full' ? 'never' : 'on-request',
      );
      assert.equal(params.approvalsReviewer, 'user');
    }
    for (const { params } of turns) {
      assert.equal(
        params.approvalPolicy,
        accessMode === 'full' ? 'never' : 'on-request',
      );
      assert.deepEqual(
        params.sandboxPolicy,
        accessMode === 'full'
          ? { type: 'dangerFullAccess' }
          : {
              type: 'workspaceWrite',
              writableRoots: [params.cwd],
              networkAccess: accessMode === 'network',
            },
      );
    }
  });
}

test('legacy runs are supervised and invalid access values are rejected before creation', async (t) => {
  const { runner } = await fixture(t);
  for (const accessMode of ['unknown', null, false, {}, 'danger-full-access']) {
    await assert.rejects(
      runner.create({ ...job(), accessMode }),
      /режим доступа/,
    );
  }
  assert.equal(runner.runs.length, 0);
  const run = await runner.create(job());
  assert.equal(run.accessMode, 'supervised');
  await settle(() => runner.current(run)?.turnId && !runner.busy);
});

test('full access still waits for human input and reapplies its policy on resume after restart', async (t) => {
  const { runner, client, dir } = await fixture(t);
  const run = await runner.create({ ...job(), accessMode: 'full' });
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  const attempt = runner.current(run);
  runner.onRequest({
    id: 'question',
    method: 'item/tool/requestUserInput',
    params: {
      threadId: attempt.threadId,
      questions: [{ id: 'candidate', question: 'Which candidate?' }],
    },
  });
  assert.equal(run.status, 'waiting_approval');
  assert.equal(client.replies.length, 0);
  await runner.answer(run.id, attempt.id, 'question', {
    answers: { candidate: 'The first one' },
  });
  await complete(runner, attempt, 'needs_input');
  assert.equal(run.status, 'waiting_user');
  runner.shutdown();
  const restored = {
    runner: new Runner({ client: new FakeCodex(), dataDir: dir }),
  };
  restored.client = restored.runner.client;
  await restored.runner.connect();
  const restoredRun = restored.runner.find(run.id);
  await restored.runner.message(
    run.id,
    attempt.id,
    'Here are the missing requirements',
  );
  const resumed = restored.client.calls.find(
    (call) => call.method === 'thread/resume',
  ).params;
  assert.equal(resumed.cwd, attempt.cwd);
  assert.equal(resumed.sandbox, 'danger-full-access');
  assert.equal(resumed.approvalPolicy, 'never');
  const turn = restored.client.calls.find(
    (call) => call.method === 'turn/start',
  ).params;
  assert.deepEqual(turn.sandboxPolicy, { type: 'dangerFullAccess' });
  assert.equal(restored.runner.current(restoredRun).id, attempt.id);
  restored.runner.shutdown();
});

test('continuation changes access explicitly, preserves completed attempts and fingerprints the choice', async (t) => {
  const { runner, client, run } = await oneStageDone(t);
  const first = structuredClone(run.stages[0]);
  const request = { ...extension(run, job().stages), accessMode: 'network' };
  runner.extend(run.id, request);
  assert.throws(
    () => runner.extend(run.id, { ...request, accessMode: 'full' }),
    /идентификатор/,
  );
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  assert.equal(run.accessMode, 'network');
  assert.deepEqual(run.stages[0], first);
  assert.equal(
    client.calls.filter((call) => call.method === 'turn/start').at(-1).params
      .sandboxPolicy.networkAccess,
    true,
  );
  await complete(runner, runner.current(run));
  const next = extension(
    run,
    [...job().stages, { ...job().stages[1], id: 'third' }],
    'next-access',
  );
  next.pipeline.accessMode = 'full';
  runner.extend(run.id, next);
  await settle(() => runner.current(run)?.turnId && !runner.busy);
  assert.equal(run.accessMode, 'network');
});
