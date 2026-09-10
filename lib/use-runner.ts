'use client';
import { useEffect, useState } from 'react';
import type { AccessMode } from './pipeline';

export type RunStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'waiting_approval'
  | 'done'
  | 'skipped'
  | 'stopped'
  | 'failed';
export type Activity = {
  id: string;
  type: string;
  text?: string;
  phase?: string;
  at?: string;
  command?: string;
  aggregatedOutput?: string;
  status?: string;
  exitCode?: number;
  tool?: string;
  server?: string;
  query?: string;
  changes?: { path: string; diff: string; kind: { type: string } }[];
};
export type PendingRequest = {
  id: string | number;
  method: string;
  params: {
    command?: string;
    reason?: string;
    cwd?: string;
    questions?: {
      id: string;
      question: string;
      isSecret?: boolean;
      options?: { label: string; description: string }[];
    }[];
  };
};
export type Attempt = {
  accessMode?: AccessMode;
  id: string;
  number: number;
  prompt: string;
  input: string;
  cwd: string;
  model?: string;
  threadId: string | null;
  turnId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
  diff: string;
  items: Activity[];
  pending: PendingRequest[];
  expansion?: { turnId: string; stageIds: string[] };
  outcome: {
    nextStages?: { name: string; prompt: string }[];
    status: string;
    summary: string;
    handoff: string;
    artifacts: string[];
  } | null;
};
export type RunStage = {
  agent?: string;
  templatePrompt?: string;
  allowStageCreation?: boolean;
  generatedBy?: { stageId: string; attemptId: string };
  archivedAt?: string;
  archiveReason?: string;
  id: string;
  name: string;
  prompt: string;
  appearance: number;
  status: RunStatus;
  attempts: Attempt[];
  activeAttemptId: string | null;
};
export type AgentRun = {
  accessMode?: AccessMode;
  generation?: number;
  continuations?: {
    id: string;
    at: string;
    from: number;
    stageIds: string[];
  }[];
  id: string;
  pipelineId: string;
  name: string;
  task: string;
  sourcePath: string;
  model: string;
  createdAt: string;
  status: RunStatus;
  cursor: number;
  stages: RunStage[];
  archivedStages?: RunStage[];
};
export type RunnerState = {
  accessProfiles?: boolean;
  workspaceRevision?: number;
  workspaceEpoch?: string | null;
  connected: boolean;
  account: { type: string } | null;
  error: string | null;
  models: { id: string; name: string; isDefault: boolean }[];
  runs: AgentRun[];
  examplePath?: string;
};
const emptyState: RunnerState = {
  connected: false,
  account: null,
  error: null,
  models: [],
  runs: [],
};
export const statusLabels: Record<RunStatus, string> = {
  idle: 'В очереди',
  queued: 'В очереди',
  running: 'Выполняется',
  waiting_user: 'Ждёт ответа',
  waiting_approval: 'Нужно решение',
  done: 'Готово',
  skipped: 'Пропущен',
  stopped: 'Остановлен',
  failed: 'Нужны исправления',
};
export function useRunner() {
  const [state, setState] = useState<RunnerState>(emptyState);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const events = new EventSource('/api/runner/events');
    events.onmessage = (event) => {
      try {
        setState(JSON.parse(event.data));
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };
    events.onerror = () => setOnline(false);
    return () => events.close();
  }, []);
  return { ...state, online };
}
export async function runnerAction<T = AgentRun>(
  route: string,
  value: unknown = {},
): Promise<T> {
  const response = await fetch('/api/runner' + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Pipeline-Client': 'local-v1',
    },
    body: JSON.stringify(value),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || 'Не удалось выполнить действие');
  return data;
}
