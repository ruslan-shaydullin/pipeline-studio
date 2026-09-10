import seed from './workspace-seed.json';
export type AccessMode = 'supervised' | 'network' | 'full';
export type Stage = {
  id: string;
  name: string;
  prompt: string;
  agent: string;
  appearance?: number;
  allowStageCreation?: boolean;
};
export type Pipeline = {
  accessMode?: AccessMode;
  id: string;
  folderId: string;
  name: string;
  description: string;
  task: string;
  stages: Stage[];
};
export type Run = {
  id: string;
  pipelineId: string;
  task: string;
  time: string;
  stages: Stage[];
  completed: number;
  status: 'running' | 'done' | 'stopped';
};
export type Workspace = {
  version: 1;
  projects: { id: string; name: string; color: string }[];
  folders: { id: string; projectId: string; name: string }[];
  pipelines: Pipeline[];
  runs: Run[];
};
export const uid = () => crypto.randomUUID();
export const agentNames: Record<string, string> = {
  default: 'По умолчанию',
  codex: 'Codex',
  claude: 'Claude Code',
};
export const initialWorkspace = seed as Workspace;
export const issuePipeline = initialWorkspace.pipelines.find(
  (p) => p.id === 'issue-fix',
)!;
