#!/usr/bin/env node
// A deterministic app-server peer. This process never calls a model or external service.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

if (!process.env.PIPELINE_FAKE_ROOT || process.argv[2] !== 'app-server')
  throw new Error('The fake Codex executable requires an isolated E2E root');
const root = realpathSync(process.env.PIPELINE_FAKE_ROOT);
function inside(file) {
  const resolved = realpathSync(file);
  if (!resolved.startsWith(root + path.sep))
    throw new Error('Outside the E2E root');
  return resolved;
}
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const threadFile = (id) => {
  if (!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid thread id');
  return path.join(root, id + '.json');
};
function review(input) {
  const { pipeline, goal } = JSON.parse(input);
  return {
    verdict: 'needs_changes',
    summary: 'Добавим проверку сохранённого результата перед завершением.',
    findings: [
      {
        severity: 'important',
        stageIds: pipeline.stages.map((s) => s.id),
        title: 'Результат не проверяется',
        evidence: 'В плане нет отдельного чтения артефакта.',
        recommendation: 'Добавить этап проверки candidate.txt.',
      },
    ],
    assumptions: ['Это синтетический сценарий проверки интерфейса.'],
    proposal: {
      task: goal,
      description: 'Пайплайн с проверкой результата.',
      stages: [
        ...pipeline.stages.map((s) => ({
          sourceId: s.id,
          name: s.name,
          prompt: s.prompt,
          allowStageCreation: !!s.allowStageCreation,
          reason: 'Сохранить исходную работу.',
        })),
        {
          sourceId: null,
          name: 'Проверка результата',
          prompt: 'E2E:READ Прочитай candidate.txt.',
          allowStageCreation: false,
          reason: 'Проверить передачу результата.',
        },
      ],
    },
  };
}
function outcome(thread, text, isReview) {
  if (isReview) return review(text);
  const instruction = text.split('Инструкция этапа:\n')[1]?.split('\n\n')[0];
  thread.kind ||= instruction?.match(/E2E:(WRITE|READ|ASK)/)?.[1];
  if (!thread.kind) throw new Error('Missing deterministic scenario marker');
  const cwd = inside(thread.cwd);
  const artifact = path.join(cwd, 'candidate.txt');
  if (thread.kind === 'ASK' && thread.turns === 1)
    return {
      status: 'needs_input',
      summary: 'Какой кандидат нужен: alpha или beta?',
      handoff: 'Ожидается выбор пользователя.',
      artifacts: [],
    };
  if (thread.kind === 'WRITE' || thread.kind === 'ASK')
    writeFileSync(
      artifact,
      thread.kind === 'ASK' ? text : `candidate-${thread.id}`,
      { flag: 'wx' },
    );
  const evidence = readFileSync(artifact, 'utf8');
  return {
    status: 'done',
    summary:
      thread.kind === 'READ'
        ? `Проверен файл: ${evidence}`
        : `Кандидат сохранён: ${evidence}`,
    handoff: `Продолжай с candidate.txt: ${evidence}`,
    artifacts: ['candidate.txt'],
  };
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (!message.method) return;
  const { id, method, params = {} } = message;
  appendFileSync(
    path.join(root, 'requests.jsonl'),
    JSON.stringify({ method, params }) + '\n',
  );
  if (id === undefined) return;
  try {
    let result = {};
    if (method === 'account/read') result = { account: { type: 'chatgpt' } };
    else if (method === 'model/list')
      result = {
        data: [
          { model: 'e2e-codex', displayName: 'E2E Codex', isDefault: true },
        ],
      };
    else if (method === 'thread/start') {
      const thread = { id: randomUUID(), cwd: inside(params.cwd), turns: 0 };
      writeFileSync(threadFile(thread.id), JSON.stringify(thread));
      result = { thread: { id: thread.id }, model: 'e2e-codex' };
    } else if (method === 'thread/resume') {
      const thread = JSON.parse(
        readFileSync(threadFile(params.threadId), 'utf8'),
      );
      inside(thread.cwd);
      result = { thread: { id: thread.id }, model: 'e2e-codex' };
    } else if (method === 'turn/start') {
      const thread = JSON.parse(
        readFileSync(threadFile(params.threadId), 'utf8'),
      );
      const turnId = randomUUID();
      thread.turns++;
      let value;
      try {
        value = outcome(
          thread,
          params.input.map((i) => i.text).join('\n'),
          !!params.outputSchema?.properties?.verdict,
        );
      } catch (error) {
        value = {
          status: 'failed',
          summary: error.message,
          handoff: 'Fixture failed',
          artifacts: [],
        };
      }
      writeFileSync(threadFile(thread.id), JSON.stringify(thread));
      send({ id, result: { turn: { id: turnId } } });
      // Let the real client store the turn id before receiving its events.
      setTimeout(() => {
        const common = { threadId: thread.id, turnId };
        send({
          method: 'item/completed',
          params: {
            ...common,
            item: {
              id: randomUUID(),
              type: 'agentMessage',
              phase: 'commentary',
              text: 'Проверяю файлы текущего этапа.',
            },
          },
        });
        send({
          method: 'item/completed',
          params: {
            ...common,
            item: {
              id: randomUUID(),
              type: 'agentMessage',
              phase: 'final_answer',
              text: JSON.stringify(value),
            },
          },
        });
        send({
          method: 'turn/completed',
          params: { ...common, turn: { id: turnId, status: 'completed' } },
        });
      }, 30);
      return;
    } else if (
      !['initialize', 'turn/interrupt', 'turn/steer'].includes(method)
    ) {
      throw new Error(`Unsupported fake method: ${method}`);
    }
    send({ id, result });
  } catch (error) {
    send({ id, error: { code: -32000, message: error.message } });
  }
});
