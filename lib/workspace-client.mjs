export const legacyWorkspaceKey = 'pipeline-studio.workspace.v1';
const migratedKey = 'pipeline-studio.workspace.migrated';
export function displayableWorkspace(value) {
  return (
    value?.version === 1 &&
    Array.isArray(value.projects) &&
    value.projects.length > 0 &&
    value.projects.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.color === 'string',
    ) &&
    Array.isArray(value.folders) &&
    value.folders.every(
      (f) =>
        typeof f.name === 'string' &&
        value.projects.some((p) => p.id === f.projectId),
    ) &&
    Array.isArray(value.pipelines) &&
    value.pipelines.length > 0 &&
    value.pipelines.every(
      (p) =>
        typeof p.name === 'string' &&
        typeof p.task === 'string' &&
        typeof p.description === 'string' &&
        value.folders.some((f) => f.id === p.folderId) &&
        Array.isArray(p.stages) &&
        p.stages.every(
          (s) =>
            typeof s.id === 'string' &&
            typeof s.name === 'string' &&
            typeof s.prompt === 'string' &&
            typeof s.agent === 'string',
        ),
    ) &&
    Array.isArray(value.runs)
  );
}
export class WorkspaceClient {
  listeners = new Set();
  version = 0;
  dirty = false;
  /** @type {Promise<void> | null} */
  inFlight = null;
  /** @type {Promise<void> | null} */
  loading = null;
  mutation = null;
  timer = null;
  started = false;
  observed = null;
  constructor({
    initial,
    request,
    readLocal,
    writeLocal,
    clientId,
    delay = 400,
  }) {
    this.request = request;
    this.readLocal = readLocal;
    this.writeLocal = writeLocal;
    this.delay = delay;
    this.outboxKey = 'pipeline-studio.workspace.outbox.' + clientId;
    this.state = {
      workspace: initial,
      ready: false,
      phase: 'loading',
      epoch: /** @type {string|null} */ (null),
      revision: 0,
      error: null,
      warning: null,
      legacyAvailable: false,
    };
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  emit(patch = {}) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  remember() {
    this.writeLocal(
      this.outboxKey,
      this.dirty || this.mutation
        ? JSON.stringify({
            workspace: this.state.workspace,
            baseRevision: this.state.revision,
            baseEpoch: this.state.epoch,
            version: this.version,
            mutation: this.mutation,
          })
        : null,
    );
  }
  adopt(remote) {
    this.emit({
      workspace: remote.workspace,
      revision: remote.revision,
      epoch: remote.epoch,
      ready: true,
      phase: 'saved',
      error: null,
      warning: remote.warning,
    });
  }
  connect = async () => {
    if (this.loading) return this.loading;
    if (this.inFlight) return this.inFlight;
    const first = !this.started;
    const version = this.version;
    this.loading = (async () => {
      try {
        let remote = await this.request('/workspace');
        if (remote.error) throw new Error(remote.error);
        const legacy = this.readLocal(legacyWorkspaceKey);
        if (!remote.workspace) {
          let workspace;
          if (legacy) {
            try {
              workspace = JSON.parse(legacy);
            } catch {
              throw new Error(
                'Старые данные браузера повреждены. Скачай их копию перед восстановлением.',
              );
            }
          }
          try {
            remote = await this.request('/workspace', {
              baseRevision: 0,
              mutationId: crypto.randomUUID(),
              workspace,
            });
            this.writeLocal(migratedKey, '1');
          } catch (error) {
            if (error.status !== 409) throw error;
            remote = await this.request('/workspace');
            if (remote.error || !remote.workspace)
              throw new Error(remote.error || 'Хранилище недоступно');
          }
        }
        if (first) {
          const raw = this.readLocal(this.outboxKey);
          if (raw) {
            const saved = JSON.parse(raw);
            if (!displayableWorkspace(saved.workspace))
              throw new Error(
                'Не удалось прочитать черновик джоб. Его копия остаётся в браузере.',
              );
            this.version = saved.version || 1;
            this.dirty = true;
            this.mutation = saved.mutation || null;
            this.emit({
              workspace: saved.workspace,
              revision: saved.baseRevision,
              epoch: saved.baseEpoch ?? 'legacy',
              ready: true,
              phase:
                (remote.epoch === (saved.baseEpoch ?? 'legacy') &&
                  remote.revision === saved.baseRevision) ||
                this.mutation
                  ? 'pending'
                  : 'conflict',
              error:
                (remote.epoch !== (saved.baseEpoch ?? 'legacy') ||
                  remote.revision !== saved.baseRevision) &&
                !this.mutation
                  ? 'Сохранённая версия изменилась. Выбери, как восстановить свои правки.'
                  : null,
            });
          } else this.adopt(remote);
        } else if (!this.dirty && !this.mutation && version === this.version)
          this.adopt(remote);
        else if (
          remote.epoch !== this.state.epoch ||
          remote.revision !== this.state.revision
        )
          this.emit({
            phase: 'conflict',
            error:
              'Джобы изменены в другой вкладке. Твои правки остаются в этом окне.',
          });
        this.started = true;
        this.emit({
          legacyAvailable: !!legacy && !this.readLocal(migratedKey),
        });
        if (this.dirty && this.state.phase !== 'conflict') this.queue();
      } catch (error) {
        this.emit({
          phase: error.status === 409 ? 'conflict' : 'error',
          error: error.message,
        });
      } finally {
        this.loading = null;
        if (this.observed) {
          const seen = this.observed;
          this.observed = null;
          this.observeRevision(seen.revision, seen.epoch);
        }
      }
    })();
    return this.loading;
  };
  set = (update) => {
    if (!this.state.ready || this.state.phase === 'conflict') return;
    const workspace =
      typeof update === 'function' ? update(this.state.workspace) : update;
    this.version++;
    this.dirty = true;
    this.emit({ workspace, phase: 'pending', error: null });
    this.remember();
    this.queue();
  };
  queue() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, this.delay);
  }
  flush = async () => {
    clearTimeout(this.timer);
    if (this.inFlight) {
      await this.inFlight;
      if (this.dirty) return this.flush();
      return;
    }
    if (!this.state.ready || this.state.phase === 'conflict')
      throw new Error(this.state.error || 'Хранилище ещё не готово');
    if (!this.dirty && !this.mutation) return;
    this.inFlight = (async () => {
      while (this.dirty || this.mutation) {
        this.mutation ||= {
          body: {
            baseRevision: this.state.revision,
            baseEpoch: this.state.epoch,
            mutationId: crypto.randomUUID(),
            workspace: this.state.workspace,
          },
          version: this.version,
        };
        const sent = this.mutation;
        this.remember();
        this.emit({ phase: 'saving', error: null });
        try {
          const remote = await this.request('/workspace', sent.body);
          if (remote.appliedRevision !== remote.revision) {
            this.mutation = null;
            this.emit({
              phase: 'conflict',
              error:
                'Пока сохранялись правки, пространство изменилось в другой вкладке.',
            });
            this.remember();
            throw Object.assign(new Error(this.state.error), { status: 409 });
          }
          this.mutation = null;
          this.dirty = this.version !== sent.version;
          this.emit({
            revision: remote.revision,
            epoch: remote.epoch,
            ...(!this.dirty ? { workspace: remote.workspace } : {}),
            phase: this.dirty ? 'pending' : 'saved',
            error: null,
          });
          this.remember();
        } catch (error) {
          this.emit({
            phase: error.status === 409 ? 'conflict' : 'error',
            error: error.message,
          });
          this.remember();
          throw error;
        }
      }
    })();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
      if (this.observed) {
        const seen = this.observed;
        this.observed = null;
        this.observeRevision(seen.revision, seen.epoch);
      }
    }
  };
  observeRevision = (revision, epoch = this.state.epoch) => {
    if (this.inFlight || this.loading) {
      if (revision) this.observed = { revision, epoch };
      return;
    }
    if (!this.state.ready) {
      void this.connect();
      return;
    }
    if (
      !revision ||
      (epoch === this.state.epoch && revision <= this.state.revision)
    )
      return;
    if (this.dirty)
      this.emit({
        phase: 'conflict',
        error:
          'Джобы изменены в другой вкладке. Твои правки остаются в этом окне.',
      });
    else void this.connect();
  };
  importData = async (workspace) => {
    await this.flush();
    const version = this.version;
    let added = 0;
    this.emit({ phase: 'saving', error: null });
    this.inFlight = (async () => {
      try {
        const remote = await this.request('/workspace/import', {
          baseRevision: this.state.revision,
          baseEpoch: this.state.epoch,
          mutationId: crypto.randomUUID(),
          workspace,
        });
        if (version !== this.version) {
          this.emit({
            phase: 'conflict',
            error:
              'Импорт завершён. Сохрани новые правки отдельными копиями или загрузи результат импорта.',
          });
          this.remember();
          throw Object.assign(new Error(this.state.error), { status: 409 });
        }
        this.adopt(remote);
        added = remote.added;
      } catch (error) {
        this.emit({
          phase: error.status === 409 ? 'conflict' : 'error',
          error: error.message,
        });
        throw error;
      }
    })();
    try {
      await this.inFlight;
      return added;
    } finally {
      this.inFlight = null;
      if (this.observed) {
        const seen = this.observed;
        this.observed = null;
        this.observeRevision(seen.revision, seen.epoch);
      }
    }
  };
  resolve = async (keepCopies) => {
    if (this.inFlight) await this.inFlight.catch(() => {});
    const local = this.state.workspace;
    const remote = await this.request('/workspace');
    if (remote.error || !remote.workspace)
      throw new Error(remote.error || 'Хранилище недоступно');
    const result = keepCopies
      ? await this.request('/workspace/import', {
          baseRevision: remote.revision,
          baseEpoch: remote.epoch,
          mutationId: crypto.randomUUID(),
          workspace: local,
        })
      : remote;
    this.writeLocal(this.outboxKey + '.previous', JSON.stringify(local));
    this.dirty = false;
    this.mutation = null;
    this.adopt(result);
    this.remember();
  };
  importLegacy = async () => {
    const raw = this.readLocal(legacyWorkspaceKey);
    if (!raw) throw new Error('Старых данных нет');
    const added = await this.importData(JSON.parse(raw));
    this.writeLocal(migratedKey, '1');
    this.emit({ legacyAvailable: false });
    return added;
  };
  dispose() {
    clearTimeout(this.timer);
  }
}
