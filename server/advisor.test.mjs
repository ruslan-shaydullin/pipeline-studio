import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Advisor } from './advisor.mjs';
import { WorkspaceStore } from './workspace.mjs';
import { pipelineFingerprint, validateReviewResult } from '../lib/advisor.mjs';
const seed = JSON.parse(
  readFileSync(new URL('../lib/workspace-seed.json', import.meta.url), 'utf8'),
);
class FakeClient extends EventEmitter {
  calls = [];
  rejected = [];
  closed = false;
  async connect() {}
  async request(method, params) {
    this.calls.push({ method, params });
    return method === 'thread/start'
      ? { thread: { id: 'review-thread' }, model: 'test' }
      : { turn: { id: 'review-turn' } };
  }
  reject(id, reason) {
    this.rejected.push({ id, reason });
  }
  close() {
    this.closed = true;
  }
}
function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pipeline-advisor-test-'));
  const workspace = new WorkspaceStore(dir);
  workspace.commit({
    baseRevision: 0,
    mutationId: 'initialize-review',
    workspace: structuredClone(seed),
  });
  const runner = {
    connected: true,
    account: { type: 'chatgpt' },
    models: [],
    runs: [],
  };
  const clients = [];
  const config = {
    dataDir: dir,
    workspace,
    runner,
    clientFactory: () => {
      const c = new FakeClient();
      clients.push(c);
      return c;
    },
    ...options,
  };
  const advisor = new Advisor(config);
  const pipeline = workspace.read().workspace.pipelines[0];
  const input = {
    pipelineId: pipeline.id,
    expectedPipeline: pipelineFingerprint(pipeline),
    goal: 'Fix the issue and verify it',
    mutationId: 'review-first',
  };
  t.after(() => {
    advisor.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  return { advisor, workspace, runner, clients, pipeline, input, config };
}
async function ready(f) {
  for (let i = 0; i < 100; i++) {
    if (f.clients[0]?.calls.some((c) => c.method === 'turn/start')) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('Review did not start');
}
function result(pipeline) {
  return {
    verdict: 'needs_changes',
    summary: 'Make handoffs explicit.',
    findings: [
      {
        severity: 'important',
        stageIds: [pipeline.stages[0].id],
        title: 'Missing acceptance criteria',
        evidence: 'The first stage has no explicit gate.',
        recommendation: 'Pass testable criteria to the next stage.',
      },
    ],
    assumptions: ['Confirm publication destination.'],
    proposal: {
      task: 'Fix the issue and verify it',
      description: 'Improved handoffs',
      stages: pipeline.stages.map((s) => ({
        sourceId: s.id,
        name: s.name,
        prompt: s.prompt + '\nReturn concrete acceptance criteria.',
        allowStageCreation: false,
        reason: 'Clarify the handoff.',
      })),
    },
  };
}
function finish(f, review, value = result(f.pipeline)) {
  f.clients[0].emit('notification', {
    method: 'item/completed',
    params: {
      threadId: review.threadId,
      item: {
        type: 'agentMessage',
        phase: 'final_answer',
        text: JSON.stringify(value),
      },
    },
  });
  f.clients[0].emit('notification', {
    method: 'turn/completed',
    params: {
      threadId: review.threadId,
      turn: { id: 'review-turn', status: 'completed' },
    },
  });
}
function edit(f, change) {
  const s = f.workspace.read();
  f.workspace.commit({
    baseRevision: s.revision,
    baseEpoch: s.epoch,
    mutationId: crypto.randomUUID(),
    workspace: change(structuredClone(s.workspace)),
  });
}

test('deep review receives all prompts, uses read-only policy without network, and has no apply side effects', async (t) => {
  const f = fixture(t);
  const before = f.workspace.read().revision;
  const r = f.advisor.create(f.input);
  await ready(f);
  const turn = f.clients[0].calls.find((c) => c.method === 'turn/start').params;
  assert.equal(turn.effort, 'high');
  assert.equal(turn.approvalPolicy, 'never');
  assert.equal(turn.sandboxPolicy.type, 'readOnly');
  assert.equal(turn.sandboxPolicy.networkAccess, false);
  const context = JSON.parse(turn.input[0].text);
  assert.deepEqual(context.pipeline, f.pipeline);
  assert.equal(context.goal, f.input.goal);
  f.clients[0].emit('request', {
    id: 'tool',
    method: 'item/tool/requestUserInput',
  });
  assert.equal(f.clients[0].rejected.length, 1);
  finish(f, r);
  assert.equal(r.status, 'done');
  assert.equal(f.workspace.read().revision, before);
  assert.equal(r.proposed.stages[0].id, f.pipeline.stages[0].id);
  assert.equal(r.proposed.accessMode, f.pipeline.accessMode);
  assert.equal(f.clients[0].closed, true);
});
test('apply and undo are persistent and idempotent, preserving other jobs and execution history', async (t) => {
  const f = fixture(t);
  const original = f.workspace.read().workspace;
  const r = f.advisor.create(f.input);
  await ready(f);
  finish(f, r);
  f.advisor.apply(r.id);
  const applied = f.workspace.read();
  f.advisor.apply(r.id);
  assert.equal(f.workspace.read().revision, applied.revision);
  assert.deepEqual(
    applied.workspace.pipelines.slice(1),
    original.pipelines.slice(1),
  );
  assert.deepEqual(applied.workspace.runs, original.runs);
  assert.deepEqual(f.runner.runs, []);
  assert.equal(
    applied.workspace.pipelines[0].stages[0].id,
    original.pipelines[0].stages[0].id,
  );
  const restored = new Advisor(f.config);
  assert.equal(restored.find(r.id).status, 'applied');
  restored.apply(r.id, true);
  const revision = f.workspace.read().revision;
  restored.apply(r.id, true);
  assert.equal(f.workspace.read().revision, revision);
  assert.deepEqual(f.workspace.read().workspace, original);
  restored.shutdown();
});
test('stale review never overwrites a changed job; unrelated job edits are preserved', async (t) => {
  const f = fixture(t);
  const r = f.advisor.create(f.input);
  await ready(f);
  finish(f, r);
  edit(f, (w) => {
    w.pipelines[1].name = 'Unrelated edit';
    return w;
  });
  f.advisor.apply(r.id);
  assert.equal(
    f.workspace.read().workspace.pipelines[1].name,
    'Unrelated edit',
  );
  edit(f, (w) => {
    w.pipelines[0].task = 'New user requirement';
    return w;
  });
  assert.throws(() => f.advisor.apply(r.id, true), /Джоба изменилась/);
  assert.equal(
    f.workspace.read().workspace.pipelines[0].task,
    'New user requirement',
  );
});
test('a changed source blocks applying a proposal and duplicate create requests do not call the model twice', async (t) => {
  const f = fixture(t);
  const r = f.advisor.create(f.input);
  assert.equal(f.advisor.create(f.input).id, r.id);
  assert.throws(
    () => f.advisor.create({ ...f.input, goal: 'Changed' }),
    /другого разбора/,
  );
  await ready(f);
  assert.equal(f.clients.length, 1);
  finish(f, r);
  edit(f, (w) => {
    w.pipelines[0].stages[0].prompt = 'User edit';
    return w;
  });
  assert.throws(() => f.advisor.apply(r.id), /Джоба изменилась/);
  assert.equal(
    f.workspace.read().workspace.pipelines[0].stages[0].prompt,
    'User edit',
  );
});
test('model output cannot increase access, invent source IDs or duplicate existing stages', async (t) => {
  const f = fixture(t);
  for (const mutate of [
    (v) => (v.proposal.accessMode = 'full'),
    (v) => (v.proposal.stages[0].sourceId = 'invented'),
    (v) => (v.proposal.stages[1].sourceId = v.proposal.stages[0].sourceId),
  ]) {
    const v = result(f.pipeline);
    mutate(v);
    assert.throws(() => validateReviewResult(v, f.pipeline));
  }
  const r = f.advisor.create(f.input);
  await ready(f);
  const bad = result(f.pipeline);
  bad.proposal.stages = [];
  finish(f, r, bad);
  assert.equal(r.status, 'failed');
  assert.equal(r.proposed, null);
  assert.throws(() => f.advisor.apply(r.id), /Сначала дождись/);
});
test('cancel ignores late results and timeout closes only the review client', async (t) => {
  const f = fixture(t);
  const r = f.advisor.create(f.input);
  await ready(f);
  f.advisor.cancel(r.id);
  finish(f, r);
  assert.equal(r.status, 'cancelled');
  assert.equal(r.result, null);
  assert.equal(f.runner.connected, true);
  assert.equal(f.clients[0].closed, true);
  const timed = fixture(t, { timeoutMs: 30 });
  const slow = timed.advisor.create(timed.input);
  for (let i = 0; i < 50 && slow.status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(slow.status, 'failed');
  assert.equal(timed.clients[0].closed, true);
});

test('failed initial persistence rolls back the review and allows the same request to retry', async (t) => {
  const f = fixture(t);
  const save = f.advisor.save.bind(f.advisor);
  f.advisor.save = () => {
    throw new Error('Disk unavailable');
  };
  assert.throws(() => f.advisor.create(f.input), /Disk unavailable/);
  assert.equal(f.advisor.reviews.length, 0);
  assert.equal(f.clients.length, 0);
  f.advisor.save = save;
  const r = f.advisor.create(f.input);
  await ready(f);
  finish(f, r);
  assert.equal(r.status, 'done');
});
test('client setup failure becomes a terminal review, without an unhandled rejection', async (t) => {
  const f = fixture(t, {
    clientFactory: () => {
      throw new Error('Cannot start client');
    },
  });
  const r = f.advisor.create(f.input);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Cannot start client/);
  assert.equal(f.advisor.sessions.size, 0);
});
test('progress and completion persistence failures close the client and prevent applying an unsaved result', async (t) => {
  for (const phase of ['commentary', 'completion']) {
    const f = fixture(t);
    const r = f.advisor.create(f.input);
    await ready(f);
    const save = f.advisor.save.bind(f.advisor);
    f.advisor.save = () => {
      throw new Error('Disk unavailable');
    };
    if (phase === 'completion') finish(f, r);
    else
      f.clients[0].emit('notification', {
        method: 'item/completed',
        params: {
          threadId: r.threadId,
          item: { type: 'agentMessage', phase, text: 'Reading the pipeline' },
        },
      });
    assert.equal(r.status, 'failed');
    assert.equal(r.proposed, null);
    assert.equal(f.clients[0].closed, true);
    assert.equal(f.advisor.sessions.size, 0);
    assert.throws(() => f.advisor.apply(r.id), /Сначала дождись/);
    f.advisor.save = save;
  }
});
