import type { Pipeline } from './pipeline';
export type PipelineReview = {
  id: string;
  pipelineId: string;
  snapshot: Pipeline;
  goal: string;
  guidance: string;
  model: string;
  createdAt: string;
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'applied' | 'reverted';
  progress: string[];
  error: string | null;
  historyCount: number;
  proposed: Pipeline | null;
  result: null | {
    verdict: 'ready' | 'needs_changes' | 'blocked';
    summary: string;
    findings: {
      severity: 'critical' | 'important' | 'suggestion';
      stageIds: string[];
      title: string;
      evidence: string;
      recommendation: string;
    }[];
    assumptions: string[];
    proposal: {
      task: string;
      description: string;
      stages: {
        sourceId: string | null;
        name: string;
        prompt: string;
        allowStageCreation: boolean;
        reason: string;
      }[];
    };
  };
};
