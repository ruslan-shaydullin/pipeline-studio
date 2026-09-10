'use client';
import { useRef, useState } from 'react';
import { Check, Database, Download, Upload, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Workspace } from '@/lib/pipeline';
import {
  downloadWorkspace,
  downloadLegacyWorkspace,
  importWorkspace,
  importLegacyWorkspace,
  retryWorkspace,
  resolveWorkspace,
} from '@/lib/use-workspace';

type Storage = {
  ready: boolean;
  phase: string;
  error: string | null;
  warning: string | null;
  legacyAvailable: boolean;
};
export function WorkspaceStorage({
  workspace,
  storage,
  notice = false,
}: {
  workspace: Workspace;
  storage: Storage;
  notice?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<unknown>(null);
  const [names, setNames] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (notice) {
    const visible = !storage.ready || storage.error || storage.warning || error;
    if (!visible) return null;
    return (
      <output
        className={
          'storage-notice' + (storage.error || error ? ' storage-problem' : '')
        }
      >
        <span>
          {error ||
            storage.error ||
            storage.warning ||
            'Подключаем хранилище джоб…'}
        </span>
        {storage.phase === 'conflict' ? (
          <>
            <button
              disabled={busy}
              onClick={() => void perform(() => resolveWorkspace(true))}
            >
              Сохранить мои копии
            </button>
            <button
              disabled={busy}
              onClick={() => void perform(() => resolveWorkspace(false))}
            >
              Загрузить сохранённое
            </button>
            <button onClick={() => downloadWorkspace(workspace)}>
              Скачать мои правки
            </button>
          </>
        ) : (
          storage.error && (
            <>
              <button
                disabled={busy}
                onClick={() => void perform(retryWorkspace)}
              >
                Повторить
              </button>
              {!storage.ready && (
                <button onClick={downloadLegacyWorkspace}>
                  Копия данных браузера
                </button>
              )}
            </>
          )
        )}
      </output>
    );
  }
  const saving = ['saving', 'pending'].includes(storage.phase);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="storage-menu-trigger"
          aria-label="Джобы и данные"
          title="Джобы и данные"
        >
          {saving ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Database size={15} />
          )}
          <span
            className={
              'storage-dot ' +
              (storage.phase === 'saved'
                ? 'saved'
                : storage.error
                  ? 'error'
                  : 'pending')
            }
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="storage-menu" align="end">
          <div className="storage-menu-heading">
            <Database size={15} />
            <div>
              <strong>Джобы на этом компьютере</strong>
              <span>
                {storage.phase === 'saved'
                  ? 'Все изменения сохранены'
                  : saving
                    ? 'Сохраняем изменения…'
                    : storage.error
                      ? 'Сохранение требует внимания'
                      : 'Подключаемся…'}
              </span>
            </div>
          </div>
          <DropdownMenuItem onClick={() => downloadWorkspace(workspace)}>
            <Download size={15} />
            Экспортировать джобы
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!storage.ready || storage.phase === 'conflict'}
            onClick={() => file.current?.click()}
          >
            <Upload size={15} />
            Импортировать из файла
          </DropdownMenuItem>
          {storage.legacyAvailable && (
            <DropdownMenuItem
              onClick={() =>
                void perform(async () => {
                  const count = await importLegacyWorkspace();
                  setResult('Из браузера добавлено джоб: ' + count);
                })
              }
            >
              Перенести прежние данные браузера
            </DropdownMenuItem>
          )}
          {result && (
            <div className="storage-import-result">
              <Check size={13} />
              {result}
            </div>
          )}
          {error && <div className="storage-import-error">{error}</div>}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Файл джоб"
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          e.target.value = '';
          if (!chosen) return;
          setOpen(true);
          setError('');
          setIncoming(null);
          try {
            if (chosen.size > 8 * 1024 * 1024)
              throw new Error('Файл должен быть меньше 8 МБ');
            const value = JSON.parse(await chosen.text());
            const source =
              value.format === 'pipeline-workspace' ? value.workspace : value;
            if (!Array.isArray(source?.pipelines))
              throw new Error('В файле не найден список джоб');
            setNames(
              source.pipelines.map((p: { name?: unknown }) =>
                typeof p.name === 'string' ? p.name : 'Без названия',
              ),
            );
            setIncoming(value);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="workspace-import-dialog">
          <DialogHeader>
            <DialogTitle>Импортировать джобы</DialogTitle>
            <DialogDescription>
              Совпадающие джобы пропустим. Изменённые копии добавим отдельно,
              сохранив существующие джобы и запуски.
            </DialogDescription>
          </DialogHeader>
          {incoming !== null && (
            <ul className="import-job-list">
              {names.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
          )}
          {error && (
            <div role="alert" className="runner-error">
              {error}
            </div>
          )}
          <button
            className="primary-button"
            disabled={busy || incoming === null}
            onClick={() =>
              void perform(async () => {
                const count = await importWorkspace(incoming);
                setResult('Добавлено джоб: ' + count);
                setOpen(false);
                setIncoming(null);
              })
            }
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Upload size={15} />
            )}
            Импортировать {names.length}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
