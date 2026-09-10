'use client';
import { useEffect, useSyncExternalStore, type SetStateAction } from 'react';
import { initialWorkspace, type Workspace } from './pipeline';
import { WorkspaceClient, legacyWorkspaceKey } from './workspace-client.mjs';

type StorageState = {
  workspace: Workspace;
  ready: boolean;
  phase: string;
  revision: number;
  error: string | null;
  warning: string | null;
  legacyAvailable: boolean;
};
const serverState: StorageState = {
  workspace: initialWorkspace,
  ready: false,
  phase: 'loading',
  revision: 0,
  error: null,
  warning: null,
  legacyAvailable: false,
};
let client: WorkspaceClient | undefined;
function getClient() {
  if (!client) {
    let clientId = crypto.randomUUID();
    try {
      clientId = sessionStorage.getItem('pipeline-studio.tab') || clientId;
      sessionStorage.setItem('pipeline-studio.tab', clientId);
    } catch {
      /* Server persistence still works without browser storage. */
    }
    client = new WorkspaceClient({
      initial: initialWorkspace,
      clientId,
      readLocal: (key: string) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      writeLocal: (key: string, value: string | null) => {
        try {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {
          /* Saving to the executor remains authoritative. */
        }
      },
      request: async (route: string, body?: unknown) => {
        const response = await fetch(
          '/api/runner' + route,
          body === undefined
            ? { cache: 'no-store' }
            : {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Pipeline-Client': 'local-v1',
                },
                body: JSON.stringify(body),
              },
        );
        const value = (await response.json()) as { error?: string };
        if (!response.ok)
          throw Object.assign(
            new Error(value.error || 'Не удалось сохранить джобы'),
            { status: response.status },
          );
        return value;
      },
    });
  }
  return client;
}
const subscribe = (listener: () => void) => {
  const store = getClient();
  const unsubscribe = store.subscribe(listener);
  void store.connect();
  return unsubscribe;
};
const getSnapshot = () => getClient().getSnapshot() as StorageState;
export function useWorkspace(
  remoteRevision?: number,
  remoteEpoch?: string | null,
) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => serverState);
  useEffect(() => {
    getClient().observeRevision(remoteRevision, remoteEpoch);
  }, [remoteRevision, remoteEpoch]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (getClient().dirty || getClient().mutation) {
        event.preventDefault();
      }
    };
    const refresh = () => {
      if (document.visibilityState === 'visible') void getClient().connect();
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return [
    state.workspace,
    (update: SetStateAction<Workspace>) => getClient().set(update),
    state,
  ] as const;
}
export const flushWorkspace = () => getClient().flush();
export const importWorkspace = (value: unknown) =>
  getClient().importData(value);
export const retryWorkspace = () =>
  getClient().state.ready ? getClient().flush() : getClient().connect();
export const resolveWorkspace = (keepCopies: boolean) =>
  getClient().resolve(keepCopies);
export const importLegacyWorkspace = () => getClient().importLegacy();
export function workspaceExport(workspace: Workspace) {
  return {
    format: 'pipeline-workspace',
    version: 1,
    workspace: { ...workspace, runs: [] },
  };
}
export function downloadWorkspace(workspace: Workspace) {
  downloadJson(workspaceExport(workspace), 'pipeline-jobs.json');
}
export function downloadLegacyWorkspace() {
  const raw = getClient().readLocal(legacyWorkspaceKey);
  if (raw) downloadJson(raw, 'pipeline-browser-backup.json', true);
}
function downloadJson(value: unknown, name: string, raw = false) {
  const url = URL.createObjectURL(
    new Blob([raw ? String(value) : JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
