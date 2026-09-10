'use client';

import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { Pipeline } from './pipeline';

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type ToolDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: Tool,
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};

export function usePipelineTools(
  pipeline: Pipeline,
  locked: boolean,
  addStage: (
    index: number,
    values?: { name: string; prompt: string },
  ) => string,
) {
  const current = useRef({ pipeline, locked, addStage });
  useEffect(() => {
    current.current = { pipeline, locked, addStage };
  });
  useEffect(() => {
    const context = (document as ToolDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: 'get_current_pipeline',
        title: 'Текущий пайплайн',
        description:
          'Read the selected job template, its task, stage prompts and order. Real Codex runs keep independent snapshots of this template.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => structuredClone(current.current.pipeline),
      },
      {
        name: 'add_pipeline_stage',
        title: 'Добавить этап',
        description:
          'Insert a stage at a zero-based position in the currently selected pipeline and select it in the visible editor. This edits the local prototype only.',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'integer', minimum: 0 },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            prompt: { type: 'string', maxLength: 30000 },
          },
          required: ['index', 'name', 'prompt'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input) {
          const value = input as Record<string, unknown>;
          if (
            !value ||
            typeof value !== 'object' ||
            !Number.isInteger(value.index) ||
            (value.index as number) < 0 ||
            (value.index as number) > current.current.pipeline.stages.length ||
            typeof value.name !== 'string' ||
            !value.name.trim() ||
            value.name.length > 100 ||
            typeof value.prompt !== 'string' ||
            value.prompt.length > 30000
          )
            throw new Error(
              'Provide a valid insertion index, name and prompt.',
            );
          if (current.current.locked)
            throw new Error('This job is temporarily locked.');
          let id = '';
          flushSync(() => {
            id = current.current.addStage(value.index as number, {
              name: (value.name as string).trim(),
              prompt: value.prompt as string,
            });
          });
          return { id, index: value.index, created: true };
        },
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch((error) =>
          console.warn('Optional pipeline tools unavailable:', error),
        );
      } catch (error) {
        console.warn('Optional pipeline tools unavailable:', error);
      }
    }
    return () => lifecycle.abort();
  }, []);
}
