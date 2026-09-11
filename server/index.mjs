import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient } from './codex.mjs';
import { Runner } from './runner.mjs';
import { Advisor } from './advisor.mjs';
import { WorkspaceStore } from './workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PIPELINE_PORT || 4317);
const dataDir = path.resolve(
  process.env.PIPELINE_DATA_DIR || path.join(root, '.pipeline-data'),
);
const workspace = new WorkspaceStore(dataDir);
const runner = new Runner({
  client: new CodexClient(),
  dataDir: path.resolve(
    process.env.PIPELINE_DATA_DIR || path.join(root, '.pipeline-data'),
  ),
});
const advisor = new Advisor({
  dataDir,
  workspace,
  runner,
  clientFactory: () => new CodexClient(),
});
const streams = new Set();
const publicState = () => ({
  ...runner.state(),
  accessProfiles: true,
  workspaceCopyAvailable: true,
  advisorAvailable: true,
  reviews: advisor.list(),
  examplePath: path.join(root, 'examples/issue-lab'),
  workspaceRevision: workspace.read().revision,
  workspaceEpoch: workspace.read().epoch,
});
const broadcast = () => {
  const event = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const response of streams) {
    if (response.writableLength > 2 * 1024 * 1024) {
      response.end();
      streams.delete(response);
    } else response.write(event);
  }
};
workspace.on('change', broadcast);
runner.on('change', broadcast);
advisor.on('change', broadcast);
function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}
async function body(request, limit = 750000) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    chunks.push(chunk);
    if (bytes > limit) throw new Error('Запрос слишком большой');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('Некорректный JSON');
  }
}
const server = http.createServer(async (request, response) => {
  // Loopback + host/origin checks + a preflighted header prevent browser sites from driving the local agent.
  const host = request.headers.host;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host))
    return json(response, 403, { error: 'Local requests only' });
  const origin = request.headers.origin;
  if (
    origin &&
    ![
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
    ].includes(origin)
  )
    return json(response, 403, { error: 'Origin not allowed' });
  if (
    request.method !== 'GET' &&
    request.headers['x-pipeline-client'] !== 'local-v1'
  )
    return json(response, 403, { error: 'Missing local client header' });
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const route = url.pathname.replace(/^\/api\/runner/, '');
  try {
    if (request.method === 'GET' && route === '/workspace')
      return json(response, 200, workspace.read());
    if (
      request.method === 'POST' &&
      ['/workspace', '/workspace/import'].includes(route)
    ) {
      const value = await body(request, 10 * 1024 * 1024);
      return json(
        response,
        200,
        workspace.commit(value, route.endsWith('/import') ? 'import' : 'save'),
      );
    }
    if (request.method === 'POST' && route === '/workspace/inspect')
      return json(response, 200, await runner.inspectCopy(await body(request)));
    if (request.method === 'GET' && route === '/state')
      return json(response, 200, publicState());
    if (request.method === 'GET' && route === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.write(`data: ${JSON.stringify(publicState())}\n\n`);
      streams.add(response);
      const ping = setInterval(() => response.write(': keepalive\n\n'), 15000);
      request.on('close', () => {
        clearInterval(ping);
        streams.delete(response);
      });
      return;
    }
    if (request.method === 'POST' && route === '/reviews')
      return json(response, 201, advisor.create(await body(request)));
    const reviewMatch = route.match(
      /^\/reviews\/([a-f0-9-]+)\/(apply|undo|cancel)$/,
    );
    if (request.method === 'POST' && reviewMatch) {
      const [, id, action] = reviewMatch;
      return json(
        response,
        200,
        action === 'cancel'
          ? advisor.cancel(id)
          : advisor.apply(id, action === 'undo'),
      );
    }
    if (request.method === 'POST' && route === '/runs')
      return json(response, 201, await runner.create(await body(request)));
    const match = route.match(
      /^\/runs\/([a-f0-9-]+)\/(stop|message|retry|answer|extend)$/,
    );
    if (request.method === 'POST' && match) {
      const value = await body(request),
        [, id, action] = match;
      if (action === 'extend') runner.extend(id, value);
      if (action === 'stop') await runner.stop(id);
      if (action === 'message')
        await runner.message(id, value.attemptId, value.text);
      if (action === 'retry')
        runner.retry(id, value.stageId, value.prompt, value.copyOptions);
      if (action === 'answer')
        await runner.answer(id, value.attemptId, value.requestId, value);
      return json(response, 200, runner.find(id));
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    json(response, error.status || 400, {
      error: error.message || 'Ошибка исполнения',
    });
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Pipeline executor: http://127.0.0.1:${port}`);
  void runner.connect();
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    advisor.shutdown();
    runner.shutdown();
    for (const response of streams) response.end();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
