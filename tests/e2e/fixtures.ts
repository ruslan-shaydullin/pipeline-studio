import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from '../../server/workspace.mjs';
import type { Workspace } from '../../lib/pipeline';
import type { RunnerState } from '../../lib/use-runner';

const source = fileURLToPath(new URL('../../', import.meta.url));
type Service = {
  process: ChildProcess;
  logs: () => string;
  stop: () => Promise<void>;
};
type Environment = {
  root: string;
  appDir: string;
  webPort: number;
  runnerPort: number;
  web: Service;
};
type App = {
  url: string;
  state: () => Promise<RunnerState>;
  workspace: () => Promise<Workspace>;
  restartRunner: () => Promise<void>;
  requests: () => Promise<{ method: string; params: { threadId?: string } }[]>;
};
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No free port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
function start(args: string[], cwd: string, env: NodeJS.ProcessEnv): Service {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-100_000);
    });
  child.on('error', (error) => {
    logs += error.stack;
  });
  return {
    process: child,
    logs: () => logs,
    async stop() {
      const signal = (value: NodeJS.Signals) => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') child.kill(value);
          else process.kill(-child.pid, value);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      };
      signal('SIGTERM');
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      const timer = setTimeout(() => signal('SIGKILL'), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
async function ready(service: Service, url: string, connected = false) {
  await expect
    .poll(
      async () => {
        if (service.process.exitCode !== null) throw new Error(service.logs());
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(2000),
          });
          return (
            response.ok &&
            (!connected || ((await response.json()) as RunnerState).connected)
          );
        } catch {
          return false;
        }
      },
      { timeout: 60_000, message: `Service did not start: ${url}` },
    )
    .toBe(true);
}
export const seed: Workspace = {
  version: 1,
  projects: [{ id: 'e2e-project', name: 'E2E Project', color: '#82999b' }],
  folders: [{ id: 'e2e-folder', projectId: 'e2e-project', name: 'Scenarios' }],
  pipelines: [
    {
      id: 'e2e-job',
      folderId: 'e2e-folder',
      name: 'Сохранение кандидата',
      description: 'Синтетическая джоба',
      task: 'Сохранить и проверить кандидата.',
      accessMode: 'supervised',
      stages: [
        {
          id: 'e2e-write',
          name: 'Поиск кандидата',
          prompt: 'E2E:WRITE Сохрани candidate.txt.',
          agent: 'codex',
        },
      ],
    },
  ],
  runs: [],
};

export const test = base.extend<{ app: App }, { environment: Environment }>({
  environment: [
    // Playwright requires object destructuring even for a fixture without dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      const root = await mkdtemp(path.join(tmpdir(), 'pipeline-e2e-'));
      const appDir = path.join(root, 'app');
      let web: Service | undefined;
      try {
        await mkdir(appDir);
        // An allowlist prevents copying local jobs, credentials, Git history or live caches.
        for (const entry of [
          'app',
          'components',
          'hooks',
          'lib',
          'server',
          'scripts',
          'public',
          'examples',
          '.openai',
          'vite.config.ts',
          'next.config.ts',
          'tsconfig.json',
          'package.json',
        ])
          await cp(path.join(source, entry), path.join(appDir, entry), {
            recursive: true,
          });
        await symlink(
          await realpath(path.join(source, 'node_modules')),
          path.join(appDir, 'node_modules'),
          'junction',
        );
        const webPort = await freePort();
        let runnerPort = await freePort();
        while (runnerPort === webPort) runnerPort = await freePort();
        const env = {
          ...process.env,
          PIPELINE_WEB_PORT: String(webPort),
          PIPELINE_PORT: String(runnerPort),
          WRANGLER_SEND_METRICS: 'false',
        };
        web = start(
          ['node_modules/vinext/dist/cli.js', 'dev', '--port', String(webPort)],
          appDir,
          env,
        );
        await ready(web, `http://127.0.0.1:${webPort}`);
        await provide({ root, appDir, webPort, runnerPort, web });
      } finally {
        await web?.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  app: async ({ environment }, provide, testInfo) => {
    const { root, appDir, webPort, runnerPort, web } = environment;
    const dataDir = await mkdtemp(path.join(root, 'data-'));
    const store = new WorkspaceStore(dataDir);
    store.commit({
      baseRevision: 0,
      baseEpoch: null,
      mutationId: 'e2e-seed-workspace',
      workspace: structuredClone(seed),
    });
    const env = {
      ...process.env,
      PIPELINE_WEB_PORT: String(webPort),
      PIPELINE_PORT: String(runnerPort),
      PIPELINE_DATA_DIR: dataDir,
      PIPELINE_CODEX_BIN: path.join(source, 'tests/e2e/fake-codex.mjs'),
      PIPELINE_FAKE_ROOT: dataDir,
    };
    const url = `http://127.0.0.1:${webPort}`;
    const runnerUrl = `http://127.0.0.1:${runnerPort}/api/runner`;
    let runner = start(['server/index.mjs'], appDir, env);
    const oldLogs: string[] = [];
    try {
      await ready(runner, runnerUrl + '/state', true);
      await provide({
        url,
        state: async () =>
          (await fetch(runnerUrl + '/state')).json() as Promise<RunnerState>,
        workspace: async () =>
          (
            (await (await fetch(runnerUrl + '/workspace')).json()) as {
              workspace: Workspace;
            }
          ).workspace,
        requests: async () =>
          (await readFile(path.join(dataDir, 'requests.jsonl'), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line)),
        restartRunner: async () => {
          await runner.stop();
          oldLogs.push(runner.logs());
          runner = start(['server/index.mjs'], appDir, env);
          await ready(runner, runnerUrl + '/state', true);
        },
      });
    } finally {
      await runner.stop();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('services.log', {
          body: [...oldLogs, runner.logs(), web.logs()].join('\n'),
          contentType: 'text/plain',
        });
        for (const file of [
          'runs.json',
          'workspace.json',
          'reviews.json',
          'requests.jsonl',
        ]) {
          try {
            await testInfo.attach(file, {
              body: await readFile(path.join(dataDir, file)),
              contentType: 'application/json',
            });
          } catch {
            /* A failed startup may not create every file. */
          }
        }
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});
export { expect };
