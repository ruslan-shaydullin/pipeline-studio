import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function localServer(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pipeline-copy-api-'));
  const processState = { server: null, exited: Promise.resolve() };
  let stopped = false;
  const signalGroup = (signal) => {
    try {
      process.kill(-processState.server.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  t.after(async () => {
    try {
      if (processState.server?.pid) {
        signalGroup('SIGTERM');
        const fallback = setTimeout(() => signalGroup('SIGKILL'), 2000);
        try {
          await processState.exited;
        } finally {
          clearTimeout(fallback);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  const dataDir = path.join(directory, 'data');
  const calls = path.join(directory, 'calls.jsonl');
  const stub = path.join(directory, 'fake-codex.mjs');
  const executable = path.join(directory, 'fake-codex');
  await writeFile(
    stub,
    `import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify(request.method) + '\\n');
  if (request.id === undefined) return;
  const result = request.method === 'account/read'
    ? { account: { type: 'chatgpt' } }
    : request.method === 'model/list' ? { data: [] } : {};
  process.stdout.write(JSON.stringify({ id: request.id, result }) + '\\n');
});
`,
  );
  await writeFile(
    executable,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(stub)} "$@"\n`,
    { mode: 0o700 },
  );
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}/api/runner`;
  let output = '';
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PIPELINE_PORT: String(port),
      PIPELINE_DATA_DIR: dataDir,
      PIPELINE_CODEX_BIN: executable,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processState.server = server;
  processState.exited = new Promise((resolve) => {
    server.once('exit', () => {
      stopped = true;
      resolve();
    });
    server.once('error', (error) => {
      output += error.message;
      stopped = true;
      resolve();
    });
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk).slice(-8000);
    });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (stopped)
      assert.fail(`Local test server exited before becoming ready: ${output}`);
    try {
      const response = await fetch(base + '/state', {
        signal: AbortSignal.timeout(500),
      });
      const state = await response.json();
      if (response.ok && state.connected && state.account)
        return { directory, dataDir, calls, base, state };
    } catch {
      // The child may not have bound its isolated loopback port yet.
    }
    await delay(30);
  }
  assert.fail(`Local test server did not become ready: ${output}`);
}

test(
  'HTTP copy inspection keeps local guards and rejects oversized launches without creating runs',
  { timeout: 15000 },
  async (t) => {
    const { directory, dataDir, calls, base, state } = await localServer(t);
    assert.equal(state.workspaceCopyAvailable, true);
    assert.deepEqual(state.runs, []);
    const source = path.join(directory, 'source');
    await mkdir(path.join(source, 'ignored'), { recursive: true });
    await mkdir(path.join(source, 'node_modules'));
    await writeFile(path.join(source, '.gitignore'), 'ignored/\n');
    await writeFile(path.join(source, 'keep.txt'), '0123456789');
    await writeFile(path.join(source, 'ignored', 'large.txt'), 'ignored data');
    await writeFile(
      path.join(source, 'node_modules', 'package.txt'),
      'dependency',
    );
    const input = {
      sourcePath: source,
      copyOptions: { maxFiles: 1, maxBytes: 5 },
    };
    const post = (route, value, headers = {}) =>
      fetch(base + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(5000),
      });
    const localHeaders = { 'X-Pipeline-Client': 'local-v1' };
    const missingHeader = await post('/workspace/inspect', input);
    assert.equal(missingHeader.status, 403);
    assert.match((await missingHeader.json()).error, /client header/);
    const wrongOrigin = await post('/workspace/inspect', input, {
      ...localHeaders,
      Origin: 'https://untrusted.example',
    });
    assert.equal(wrongOrigin.status, 403);
    assert.match((await wrongOrigin.json()).error, /Origin/);

    const preview = await post('/workspace/inspect', input, {
      ...localHeaders,
      Origin: 'http://localhost:3000',
    });
    assert.equal(preview.status, 200);
    const report = await preview.json();
    assert.equal(report.fileCount, 2);
    assert.equal(report.bytes, 19);
    assert.equal(report.excludedCount, 2);
    assert.deepEqual(report.exceeded, ['files', 'bytes']);
    assert.deepEqual(report.limits, input.copyOptions);
    assert.deepEqual(report.ignoreFiles, ['.gitignore']);
    const launch = await post(
      '/runs',
      {
        ...input,
        pipelineId: 'copy-api-test',
        name: 'Synthetic copy test',
        task: 'Inspect synthetic files',
        stages: [
          {
            id: 'first',
            name: 'First',
            agent: 'codex',
            prompt: 'Inspect the files',
          },
        ],
      },
      localHeaders,
    );
    assert.equal(launch.status, 400);
    assert.match((await launch.json()).error, /лимит копирования/);
    const after = await (
      await fetch(base + '/state', { signal: AbortSignal.timeout(5000) })
    ).json();
    assert.deepEqual(after.runs, []);
    const saved = await readFile(path.join(dataDir, 'runs.json'), 'utf8').catch(
      (error) => {
        if (error.code === 'ENOENT') return '{"runs":[]}';
        throw error;
      },
    );
    assert.deepEqual(JSON.parse(saved).runs, []);
    await assert.rejects(readFile(path.join(dataDir, 'workspaces')), {
      code: 'ENOENT',
    });
    const methods = (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.ok(methods.includes('initialize'));
    assert.ok(methods.includes('account/read'));
    assert.ok(methods.includes('model/list'));
    assert.ok(!methods.includes('thread/start'));
  },
);
