import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore, validateWorkspace } from './workspace.mjs';
import {
  WorkspaceClient,
  legacyWorkspaceKey,
} from '../lib/workspace-client.mjs';
const seed = JSON.parse(
  readFileSync(new URL('../lib/workspace-seed.json', import.meta.url), 'utf8'),
);
const copy = () => structuredClone(seed);
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'workspace-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new WorkspaceStore(dir);
  const request = async (route, body) =>
    body === undefined
      ? store.read()
      : store.commit(body, route.endsWith('/import') ? 'import' : 'save');
  function client(id = 'tab', local = new Map(), fetch = request) {
    const c = new WorkspaceClient({
      initial: copy(),
      request: fetch,
      clientId: id,
      delay: 100000,
      readLocal: (k) => local.get(k) || null,
      writeLocal: (k, v) => (v === null ? local.delete(k) : local.set(k, v)),
    });
    t.after(() => c.dispose());
    return c;
  }
  return { dir, store, request, client };
}
test('migration preserves original IDs, templates and prior history across restart', async (t) => {
  const { store, dir, client } = fixture(t);
  const old = copy();
  old.pipelines[0].name = 'Моя джоба';
  const local = new Map([[legacyWorkspaceKey, JSON.stringify(old)]]);
  const c = client('a', local);
  await c.connect();
  assert.equal(c.state.phase, 'saved');
  assert.equal(
    new WorkspaceStore(dir).read().workspace.pipelines[0].name,
    'Моя джоба',
  );
  assert.equal(store.read().workspace.pipelines[0].id, 'issue-fix');
  assert.equal(local.get(legacyWorkspaceKey), JSON.stringify(old));
});
test('damaged browser data never silently becomes seeded server data', async (t) => {
  const { store, client } = fixture(t);
  const c = client('a', new Map([[legacyWorkspaceKey, '{broken']]));
  await c.connect();
  assert.equal(c.state.phase, 'error');
  assert.equal(store.read().workspace, null);
});
test('edits during a save remain in the UI and are saved in the next revision', async (t) => {
  const { store, request, client } = fixture(t);
  let release;
  let block = false;
  const c = client('a', new Map(), async (route, body) => {
    const response = await request(route, body);
    if (block && body) {
      block = false;
      await new Promise((r) => (release = r));
    }
    return response;
  });
  await c.connect();
  block = true;
  c.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) => (i ? p : { ...p, name: 'First' })),
  }));
  const saving = c.flush();
  while (!release) await new Promise((r) => setTimeout(r, 1));
  c.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) => (i ? p : { ...p, name: 'Second' })),
  }));
  release();
  await saving;
  assert.equal(c.state.workspace.pipelines[0].name, 'Second');
  assert.equal(store.read().workspace.pipelines[0].name, 'Second');
  assert.equal(store.read().revision, 3);
});
test('lost save response retries the same mutation without a second write', async (t) => {
  const { store, request, client } = fixture(t);
  let lose = false;
  const c = client('a', new Map(), async (route, body) => {
    const result = await request(route, body);
    if (lose) {
      lose = false;
      throw new Error('Disconnected');
    }
    return result;
  });
  await c.connect();
  lose = true;
  c.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) => (i ? p : { ...p, name: 'Persisted' })),
  }));
  await assert.rejects(c.flush(), /Disconnected/);
  assert.equal(store.read().revision, 2);
  await c.flush();
  assert.equal(store.read().revision, 2);
  assert.equal(c.state.phase, 'saved');
});
test('stale tab conflicts, keeps its draft, and can merge it as a separate job', async (t) => {
  const { store, client } = fixture(t);
  const a = client('a'),
    b = client('b');
  await a.connect();
  await b.connect();
  a.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) => (i ? p : { ...p, name: 'A' })),
  }));
  b.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) => (i ? p : { ...p, name: 'B' })),
  }));
  await a.flush();
  await assert.rejects(b.flush(), (e) => e.status === 409);
  assert.equal(b.state.workspace.pipelines[0].name, 'B');
  assert.equal(store.read().workspace.pipelines[0].name, 'A');
  await b.resolve(true);
  assert.ok(store.read().workspace.pipelines.some((p) => p.name === 'A'));
  assert.ok(store.read().workspace.pipelines.some((p) => p.name === 'B'));
});
test('clean tab observes another tab revision; dirty tab never silently reloads', async (t) => {
  const { store, client } = fixture(t);
  const a = client('a'),
    b = client('b');
  await a.connect();
  await b.connect();
  a.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) => (i ? p : { ...p, name: 'Remote' })),
  }));
  await a.flush();
  b.observeRevision(store.read().revision);
  await b.loading;
  assert.equal(b.state.workspace.pipelines[0].name, 'Remote');
  b.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) =>
      i ? p : { ...p, name: 'Local draft' },
    ),
  }));
  b.observeRevision(store.read().revision + 1);
  assert.equal(b.state.phase, 'conflict');
  assert.equal(b.state.workspace.pipelines[0].name, 'Local draft');
});
test('import is additive, idempotent by content, validates relations before any write', (t) => {
  const { store } = fixture(t);
  store.commit({
    baseEpoch: store.read().epoch,
    baseRevision: 0,
    mutationId: 'initialize',
    workspace: copy(),
  });
  const imported = copy();
  imported.pipelines[0].name = 'Changed';
  let r = store.commit(
    {
      baseEpoch: store.read().epoch,
      baseRevision: 1,
      mutationId: 'import-first',
      workspace: {
        format: 'pipeline-workspace',
        version: 1,
        workspace: imported,
      },
    },
    'import',
  );
  assert.equal(r.added, 1);
  assert.equal(r.workspace.pipelines.length, seed.pipelines.length + 1);
  r = store.commit(
    {
      baseEpoch: store.read().epoch,
      baseRevision: r.revision,
      mutationId: 'import-again',
      workspace: imported,
    },
    'import',
  );
  assert.equal(r.added, 0);
  imported.pipelines[0].folderId = 'missing';
  assert.throws(
    () =>
      store.commit(
        {
          baseEpoch: store.read().epoch,
          baseRevision: r.revision,
          mutationId: 'import-invalid',
          workspace: imported,
        },
        'import',
      ),
    /связи/,
  );
  assert.equal(store.read().revision, r.revision);
  const invalid = copy();
  invalid.pipelines[1].id = invalid.pipelines[0].id;
  assert.throws(() => validateWorkspace(invalid), /Повторяющиеся/);
});
test('corrupt primary restores last valid backup and preserves damaged file', (t) => {
  const { dir, store } = fixture(t);
  store.commit({
    baseEpoch: store.read().epoch,
    baseRevision: 0,
    mutationId: 'initialize',
    workspace: copy(),
  });
  const next = copy();
  next.pipelines[0].name = 'Next';
  store.commit({
    baseEpoch: store.read().epoch,
    baseRevision: 1,
    mutationId: 'next-version',
    workspace: next,
  });
  writeFileSync(path.join(dir, 'workspace.json'), '{bad');
  const recovered = new WorkspaceStore(dir);
  assert.equal(recovered.read().revision, 1);
  assert.ok(recovered.read().warning);
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, 'workspace.json'), 'utf8')).revision,
    1,
  );
});
test('failed disk write never advances in-memory state or reports success', (t) => {
  const { dir, store } = fixture(t);
  store.commit({
    baseEpoch: store.read().epoch,
    baseRevision: 0,
    mutationId: 'initialize',
    workspace: copy(),
  });
  const broken = new WorkspaceStore(dir, {
    writeAtomic: () => {
      throw new Error('Disk full');
    },
  });
  assert.throws(
    () =>
      broken.commit({
        baseEpoch: broken.read().epoch,
        baseRevision: 1,
        mutationId: 'disk-failure',
        workspace: copy(),
      }),
    /Disk full/,
  );
  assert.equal(broken.read().revision, 1);
  assert.equal(new WorkspaceStore(dir).read().revision, 1);
});
test('concurrent initialization never overwrites the winning browser', async (t) => {
  const { store, client } = fixture(t);
  const old = copy();
  old.pipelines[0].name = 'Browser B';
  const a = client('a'),
    b = client('b', new Map([[legacyWorkspaceKey, JSON.stringify(old)]]));
  await Promise.all([a.connect(), b.connect()]);
  assert.equal(store.read().revision, 1);
  assert.equal(b.state.ready, true);
  assert.equal(b.state.legacyAvailable, true);
  await b.importLegacy();
  assert.ok(
    store.read().workspace.pipelines.some((p) => p.name === 'Browser B'),
  );
});
test('first connection failure does not discard a persisted outbox on retry', async (t) => {
  const { store, request, client } = fixture(t);
  const local = new Map();
  const first = client('a', local);
  await first.connect();
  first.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) =>
      i ? p : { ...p, name: 'Unsaved draft' },
    ),
  }));
  first.dispose();
  let fail = true;
  const restored = client('a', local, async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('Offline');
    }
    return request(...args);
  });
  await restored.connect();
  await restored.connect();
  assert.equal(restored.state.workspace.pipelines[0].name, 'Unsaved draft');
  await restored.flush();
  assert.equal(store.read().workspace.pipelines[0].name, 'Unsaved draft');
});
test('typing during import is preserved as a conflict, never marked saved', async (t) => {
  const { store, request, client } = fixture(t);
  let release;
  const c = client('a', new Map(), async (route, body) => {
    const result = await request(route, body);
    if (route.endsWith('/import')) await new Promise((r) => (release = r));
    return result;
  });
  await c.connect();
  const imported = copy();
  imported.pipelines[0].name = 'Imported';
  const importing = c.importData(imported);
  while (!release) await new Promise((r) => setTimeout(r, 1));
  c.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) =>
      i ? p : { ...p, name: 'Typed during import' },
    ),
  }));
  release();
  await assert.rejects(importing, (e) => e.status === 409);
  assert.equal(c.state.phase, 'conflict');
  assert.equal(c.state.workspace.pipelines[0].name, 'Typed during import');
  assert.ok(
    store.read().workspace.pipelines.some((p) => p.name === 'Imported'),
  );
});
test('backup recovery changes epoch so a reused revision cannot accept stale writes', (t) => {
  const { dir, store } = fixture(t);
  store.commit({
    baseRevision: 0,
    mutationId: 'initialize',
    workspace: copy(),
  });
  store.commit({
    baseRevision: 1,
    baseEpoch: store.read().epoch,
    mutationId: 'revision-two',
    workspace: copy(),
  });
  const stale = store.read();
  writeFileSync(path.join(dir, 'workspace.json'), '{bad');
  const recovered = new WorkspaceStore(dir);
  const next = copy();
  next.pipelines[0].name = 'Recovered new edit';
  recovered.commit({
    baseRevision: 1,
    baseEpoch: recovered.read().epoch,
    mutationId: 'after-recovery',
    workspace: next,
  });
  assert.equal(recovered.read().revision, stale.revision);
  assert.throws(
    () =>
      recovered.commit({
        baseRevision: stale.revision,
        baseEpoch: stale.epoch,
        mutationId: 'stale-write',
        workspace: copy(),
      }),
    (e) => e.status === 409,
  );
  assert.equal(
    recovered.read().workspace.pipelines[0].name,
    'Recovered new edit',
  );
});
test('remote change observed during save is refreshed after the response', async (t) => {
  const { store, request, client } = fixture(t);
  let release;
  let blocked = false;
  const c = client('a', new Map(), async (...args) => {
    const result = await request(...args);
    if (blocked) {
      blocked = false;
      await new Promise((r) => (release = r));
    }
    return result;
  });
  await c.connect();
  c.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) => (i ? p : { ...p, name: 'Mine' })),
  }));
  blocked = true;
  const saving = c.flush();
  while (!release) await new Promise((r) => setTimeout(r, 1));
  const next = structuredClone(store.read().workspace);
  next.pipelines[0].name = 'Remote';
  const remote = store.commit({
    baseRevision: store.read().revision,
    baseEpoch: store.read().epoch,
    mutationId: 'remote-write',
    workspace: next,
  });
  c.observeRevision(remote.revision, remote.epoch);
  release();
  await saving;
  await c.loading;
  assert.equal(c.state.workspace.pipelines[0].name, 'Remote');
});
test('remote revision received during initial GET is loaded after that GET completes', async (t) => {
  const { store, request, client } = fixture(t);
  const initializer = client('init');
  await initializer.connect();
  let release,
    block = true;
  const c = client('a', new Map(), async (...args) => {
    const r = await request(...args);
    if (block) {
      block = false;
      await new Promise((resolve) => (release = resolve));
    }
    return r;
  });
  const connecting = c.connect();
  while (!release) await new Promise((r) => setTimeout(r, 1));
  const newer = copy();
  newer.pipelines[0].name = 'Newer remote';
  const remote = store.commit({
    baseEpoch: store.read().epoch,
    baseRevision: 1,
    mutationId: 'during-read',
    workspace: newer,
  });
  c.observeRevision(remote.revision, remote.epoch);
  release();
  await connecting;
  await c.loading;
  assert.equal(c.state.workspace.pipelines[0].name, 'Newer remote');
});

test('pipeline access profiles survive saving, restart and import without changing legacy jobs', async (t) => {
  const { client, store, dir } = fixture(t);
  const c = client();
  await c.connect();
  assert.equal(c.state.workspace.pipelines[0].accessMode, undefined);
  c.set((w) => ({
    ...w,
    pipelines: w.pipelines.map((p, i) =>
      i ? p : { ...p, accessMode: 'full' },
    ),
  }));
  await c.flush();
  const saved = new WorkspaceStore(dir).read().workspace;
  assert.equal(saved.pipelines[0].accessMode, 'full');
  assert.deepEqual(validateWorkspace(saved), saved);
  const changed = structuredClone(saved);
  changed.pipelines[0].accessMode = 'network';
  const current = store.read();
  store.commit(
    {
      workspace: changed,
      baseRevision: current.revision,
      baseEpoch: current.epoch,
      mutationId: 'access-import',
    },
    'import',
  );
  assert.ok(
    store.read().workspace.pipelines.some((p) => p.accessMode === 'network'),
  );
  for (const value of ['unknown', null, false, {}]) {
    const bad = copy();
    bad.pipelines[0].accessMode = value;
    assert.throws(() => validateWorkspace(bad), /режим доступа/);
  }
});
