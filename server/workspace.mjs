import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeAccessMode } from '../lib/access.mjs';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';

const seed = JSON.parse(
  readFileSync(new URL('../lib/workspace-seed.json', import.meta.url), 'utf8'),
);
const maxBytes = 8 * 1024 * 1024;
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function array(value, name, max) {
  if (!Array.isArray(value) || value.length > max)
    fail('Некорректный список: ' + name);
  return value;
}
function string(value, name, max = 160) {
  if (typeof value !== 'string' || value.length > max)
    fail('Некорректное поле: ' + name);
  return value;
}
function id(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value) ||
    ['constructor', 'prototype', '__proto__'].includes(value)
  )
    fail('Некорректный идентификатор');
  return value;
}
function unique(items, name) {
  if (new Set(items.map((x) => x.id)).size !== items.length)
    fail('Повторяющиеся идентификаторы: ' + name);
  return items;
}
function stage(value) {
  if (!value || !['default', 'codex', 'claude'].includes(value.agent))
    fail('Некорректный исполнитель этапа');
  if (
    value.allowStageCreation !== undefined &&
    typeof value.allowStageCreation !== 'boolean'
  )
    fail('Некорректное разрешение создавать этапы');
  if (
    value.appearance !== undefined &&
    (!Number.isInteger(value.appearance) ||
      value.appearance < 0 ||
      value.appearance > 20)
  )
    fail('Некорректный цвет этапа');
  return {
    id: id(value.id),
    name: string(value.name, 'Название этапа'),
    prompt: string(value.prompt, 'Промпт', 30000),
    agent: value.agent,
    ...(value.appearance !== undefined ? { appearance: value.appearance } : {}),
    ...(value.allowStageCreation ? { allowStageCreation: true } : {}),
  };
}
export function validateWorkspace(input) {
  if (!input || input.version !== 1)
    fail('Эта версия файла пространства не поддерживается');
  if (Buffer.byteLength(JSON.stringify(input)) > maxBytes)
    fail('Пространство превышает 8 МБ');
  const projects = unique(
    array(input.projects, 'Проекты', 200).map((p) => ({
      id: id(p.id),
      name: string(p.name, 'Название проекта'),
      color: string(p.color, 'Цвет проекта', 30),
    })),
    'Проекты',
  );
  const folders = unique(
    array(input.folders, 'Папки', 1000).map((f) => ({
      id: id(f.id),
      projectId: id(f.projectId),
      name: string(f.name, 'Название папки'),
    })),
    'Папки',
  );
  const pipelines = unique(
    array(input.pipelines, 'Джобы', 1000).map((p) => ({
      id: id(p.id),
      folderId: id(p.folderId),
      name: string(p.name, 'Название джобы'),
      description: string(p.description, 'Описание', 5000),
      task: string(p.task, 'Задача', 30000),
      ...(p.accessMode !== undefined
        ? { accessMode: normalizeAccessMode(p.accessMode) }
        : {}),
      stages: unique(array(p.stages, 'Этапы', 50).map(stage), 'Этапы'),
    })),
    'Джобы',
  );
  if (!projects.length || !folders.length || !pipelines.length)
    fail('В пространстве должны быть проект, папка и хотя бы одна джоба');
  if (
    folders.some((f) => !projects.some((p) => p.id === f.projectId)) ||
    pipelines.some((p) => !folders.some((f) => f.id === p.folderId))
  )
    fail('Нарушены связи проектов, папок и джоб');
  const runs = unique(
    array(input.runs ?? [], 'Демо-запуски', 1000).map((r) => {
      if (
        !['running', 'done', 'stopped'].includes(r.status) ||
        !Number.isInteger(r.completed) ||
        r.completed < 0 ||
        !Number.isFinite(Date.parse(r.time))
      )
        fail('Некорректная история демо-запуска');
      return {
        id: id(r.id),
        pipelineId: id(r.pipelineId),
        task: string(r.task, 'Задача запуска', 30000),
        time: r.time,
        stages: array(r.stages, 'Этапы истории', 50).map(stage),
        completed: r.completed,
        status: r.status === 'running' ? 'stopped' : r.status,
      };
    }),
    'Демо-запуски',
  );
  return { version: 1, projects, folders, pipelines, runs };
}
export function readWorkspaceImport(input) {
  if (input?.format === 'pipeline-workspace') {
    if (input.version !== 1) fail('Эта версия экспорта не поддерживается');
    return validateWorkspace(input.workspace);
  }
  if (input?.format !== undefined) fail('Неизвестный формат экспорта');
  return validateWorkspace(input);
}
export function mergeWorkspaces(current, incoming) {
  const result = structuredClone(current);
  const projects = new Map(),
    folders = new Map(),
    pipelines = new Map();
  let added = 0;
  for (const p of incoming.projects) {
    const same = result.projects.find(
      (x) => x.name === p.name && x.color === p.color,
    );
    const chosen = same || {
      ...p,
      id: result.projects.some((x) => x.id === p.id) ? randomUUID() : p.id,
    };
    if (!same) result.projects.push(chosen);
    projects.set(p.id, chosen.id);
  }
  for (const f of incoming.folders) {
    const projectId = projects.get(f.projectId);
    const same = result.folders.find(
      (x) => x.projectId === projectId && x.name === f.name,
    );
    const chosen = same || {
      ...f,
      projectId,
      id: result.folders.some((x) => x.id === f.id) ? randomUUID() : f.id,
    };
    if (!same) result.folders.push(chosen);
    folders.set(f.id, chosen.id);
  }
  for (const p of incoming.pipelines) {
    const candidate = { ...p, folderId: folders.get(p.folderId) };
    const content = ({ id: _id, ...value }) => JSON.stringify(value);
    const same = result.pipelines.find(
      (x) => content(x) === content(candidate),
    );
    const chosen = same || {
      ...candidate,
      id: result.pipelines.some((x) => x.id === p.id) ? randomUUID() : p.id,
    };
    if (!same) {
      result.pipelines.push(chosen);
      added++;
    }
    pipelines.set(p.id, chosen.id);
  }
  for (const r of incoming.runs) {
    if (!pipelines.has(r.pipelineId)) continue;
    const candidate = { ...r, pipelineId: pipelines.get(r.pipelineId) };
    if (
      result.runs.some((x) => JSON.stringify(x) === JSON.stringify(candidate))
    )
      continue;
    result.runs.push({
      ...candidate,
      id: result.runs.some((x) => x.id === r.id) ? randomUUID() : r.id,
    });
  }
  return { workspace: validateWorkspace(result), added };
}
export class WorkspaceStore extends EventEmitter {
  envelope = null;
  warning = null;
  error = null;
  constructor(dataDir, { writeAtomic } = {}) {
    super();
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, 'workspace.json');
    this.backup = this.file + '.bak';
    this.writeAtomic =
      writeAtomic ||
      ((file, value) => {
        const temp = file + '.tmp';
        writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
        renameSync(temp, file);
      });
    if (existsSync(this.file) || existsSync(this.backup)) {
      try {
        this.envelope = this.load(this.file);
      } catch {
        try {
          this.envelope = {
            ...this.load(this.backup),
            epoch: randomUUID(),
            mutations: [],
          };
          if (existsSync(this.file))
            copyFileSync(this.file, this.file + '.corrupt-' + Date.now());
          this.writeAtomic(this.file, this.envelope);
          this.warning = 'Джобы восстановлены из последней резервной копии.';
        } catch {
          this.error =
            'Не удалось прочитать хранилище джоб. Исходные файлы сохранены; проверь workspace.json и его резервную копию.';
        }
      }
    }
  }
  load(file) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (
      saved.version !== 1 ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 1
    )
      fail('Некорректная версия хранилища');
    return {
      ...saved,
      epoch: typeof saved.epoch === 'string' ? saved.epoch : 'legacy',
      workspace: validateWorkspace(saved.workspace),
      mutations: Array.isArray(saved.mutations) ? saved.mutations : [],
    };
  }
  read() {
    return {
      epoch: this.envelope?.epoch ?? null,
      workspace: this.envelope?.workspace ?? null,
      revision: this.envelope?.revision ?? 0,
      updatedAt: this.envelope?.updatedAt ?? null,
      warning: this.warning,
      error: this.error,
    };
  }
  commit({ baseRevision, baseEpoch, mutationId, workspace }, kind = 'save') {
    if (this.error) fail(this.error, 503);
    if (
      typeof mutationId !== 'string' ||
      mutationId.length < 8 ||
      mutationId.length > 100
    )
      fail('Нужен идентификатор сохранения');
    if (this.envelope && baseEpoch !== this.envelope.epoch)
      fail(
        'Хранилище было восстановлено. Обнови сохранённую версию или сохрани свои копии.',
        409,
      );
    const hash = createHash('sha256')
      .update(JSON.stringify({ kind, workspace }))
      .digest('hex');
    const receipt = this.envelope?.mutations.find((x) => x.id === mutationId);
    if (receipt) {
      if (receipt.hash !== hash)
        fail('Этот идентификатор уже использован для другой записи', 409);
      return {
        ...this.read(),
        appliedRevision: receipt.revision,
        added: receipt.added,
      };
    }
    if (baseRevision !== (this.envelope?.revision ?? 0))
      fail(
        'Джобы изменены в другой вкладке. Твои правки сохранены отдельно.',
        409,
      );
    let normalized, added;
    if (kind === 'import') {
      const merged = mergeWorkspaces(
        this.envelope?.workspace || seed,
        readWorkspaceImport(workspace),
      );
      normalized = merged.workspace;
      added = merged.added;
    } else normalized = validateWorkspace(workspace ?? seed);
    const revision = baseRevision + 1;
    const next = {
      version: 1,
      epoch: this.envelope?.epoch || randomUUID(),
      revision,
      updatedAt: new Date().toISOString(),
      workspace: normalized,
      mutations: [
        ...(this.envelope?.mutations || []),
        { id: mutationId, hash, revision, added },
      ].slice(-64),
    };
    this.writeAtomic(this.backup, this.envelope || next);
    this.writeAtomic(this.file, next);
    this.envelope = next;
    this.emit('change');
    return { ...this.read(), appliedRevision: revision, added };
  }
}
