'use client';
import { PipelineAccess } from './access-settings';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type ButtonHTMLAttributes,
  type SubmitEvent,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  History,
  Layers2,
  Loader2,
  Maximize,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Play,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Toaster, toast as toastManager } from '@/components/ui/toast';
import { uid, agentNames, type Pipeline, type Stage } from '@/lib/pipeline';
import { usePipelineTools } from '@/lib/use-pipeline-tools';
import { useWorkspace, flushWorkspace } from '@/lib/use-workspace';
import { WorkspaceStorage } from './workspace-storage';
import { Switch } from '@/components/ui/switch';
import { useRunner, runnerAction, type AgentRun } from '@/lib/use-runner';
import { continuationPlan, recentRun } from '@/lib/continuation.mjs';
import { RunsPanel, RunLauncher } from './runs-panel';

type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
};
const toast = Object.assign(
  (title: string, options?: ToastOptions) =>
    toastManager.add({
      title,
      description: options?.description,
      type: 'info',
      actionProps: options?.action
        ? { children: options.action.label, onClick: options.action.onClick }
        : undefined,
    }),
  {
    error: (title: string) => toastManager.add({ title, type: 'error' }),
    success: (title: string, options?: ToastOptions) =>
      toastManager.add({
        title,
        description: options?.description,
        type: 'success',
      }),
  },
);
function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button aria-label={label} className="icon-button" {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
function stageAppearance(stage: Stage) {
  if (
    Number.isInteger(stage.appearance) &&
    stage.appearance! >= 0 &&
    stage.appearance! < 4
  )
    return stage.appearance!;
  return (
    ({ plan: 0, implement: 1, review: 2 } as Record<string, number>)[
      stage.id
    ] ?? 3
  );
}
function StageIcon({ index }: { index: number }) {
  const Icon = [FileText, Code2, ShieldCheck][index % 3];
  return <Icon size={18} strokeWidth={1.7} />;
}

function StageSettings({
  stage,
  pipeline,
  index,
  locked,
  patchStage,
  patchPipeline,
  id,
}: {
  stage: Stage;
  pipeline: Pipeline;
  index: number;
  locked: boolean;
  patchStage: (patch: Partial<Stage>) => void;
  patchPipeline: (patch: Partial<Pipeline>) => void;
  id: string;
}) {
  return (
    <div className="stage-settings">
      <label className="settings-label" htmlFor={`${id}-agent`}>
        Исполнитель
      </label>
      <Select
        value={stage.agent}
        onValueChange={(value) => patchStage({ agent: String(value) })}
        disabled={locked}
      >
        <SelectTrigger
          id={`${id}-agent`}
          className="model-select"
          aria-label="Исполнитель этапа"
        >
          <Bot size={16} />
          <SelectValue>{agentNames[stage.agent]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(agentNames).map(([value, name]) => (
            <SelectItem key={value} value={value} disabled={value === 'claude'}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="settings-label context-heading">
        Входной контекст <span>{index > 0 ? 2 : 1}</span>
      </div>
      <div className="context-item">
        <FileText size={15} />
        <span>Задача пайплайна</span>
        <Check size={13} />
      </div>
      {index > 0 && (
        <div className="context-item">
          <ArrowDown size={15} />
          <span>{pipeline.stages[index - 1].name}</span>
          <Check size={13} />
        </div>
      )}
      <label className="task-label" htmlFor={id}>
        Задача для запуска
      </label>
      <textarea
        id={id}
        className="task-input"
        placeholder="Что нужно сделать?"
        value={pipeline.task}
        disabled={locked}
        onChange={(e) => patchPipeline({ task: e.target.value })}
      />
      <p className="context-note">
        <Layers2 size={13} /> Контекст передаётся автоматически
      </p>
    </div>
  );
}

export default function Home() {
  const runner = useRunner();
  const [data, setData, storage] = useWorkspace(
    runner.workspaceRevision,
    runner.workspaceEpoch,
  );
  const [pipelineId, setPipelineId] = useState('issue-fix');
  const [stageId, setStageId] = useState('issue-plan');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [view, updateView] = useState('runs');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const sidebarBeforeExpand = useRef(true);
  const [sessionTarget, setSessionTarget] = useState<{
    runId: string;
    stageId: string;
  } | null>(null);
  function setView(value: string) {
    if (value !== 'runs' && sessionExpanded) {
      setSessionExpanded(false);
      setSidebarOpen(sidebarBeforeExpand.current);
    }
    updateView(value);
  }
  function toggleSessionExpanded() {
    if (sessionExpanded) {
      setSidebarOpen(sidebarBeforeExpand.current);
    } else {
      sidebarBeforeExpand.current = sidebarOpen;
      setSidebarOpen(false);
    }
    setSessionExpanded(!sessionExpanded);
  }
  const [detail, setDetail] = useState('prompt');
  const [collapsed, setCollapsed] = useState<string[]>([
    'personal',
    'research',
  ]);
  const [assistant, setAssistant] = useState(false);
  const [checked, setChecked] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [canvasWidth, setCanvasWidth] = useState(1000);
  const [dialog, setDialog] = useState<null | {
    kind: 'project' | 'folder' | 'pipeline';
    parentId?: string;
  }>(null);
  const [newName, setNewName] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [selectedRuns, setSelectedRuns] = useState<
    Record<string, string | null>
  >({});
  const runId = selectedRuns[pipelineId] || null;
  function setRunId(id: string | null) {
    setSelectedRuns((previous) => ({ ...previous, [pipelineId]: id }));
  }
  const canvasRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const pipeline =
    data.pipelines.find((p) => p.id === pipelineId) ?? data.pipelines[0];
  const folder = data.folders.find((f) => f.id === pipeline.folderId)!;
  const project = data.projects.find((p) => p.id === folder.projectId)!;
  const stage =
    pipeline.stages.find((s) => s.id === stageId) ?? pipeline.stages[0];
  const index = pipeline.stages.findIndex((s) => s.id === stage?.id);
  const compactCanvas = canvasWidth < 800;
  const trackWidth =
    pipeline.stages.length * (compactCanvas ? 112 : 144) +
    Math.max(0, pipeline.stages.length - 1) * (compactCanvas ? 24 : 72) +
    (compactCanvas ? 104 : 168);
  const fitZoom = Math.min(
    100,
    Math.max(85, Math.floor(((canvasWidth - 32) / trackWidth) * 100)),
  );
  const displayZoom = Math.round((fitZoom * zoom) / 100);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width);
      if (entry.contentRect.width > 844) {
        setDetail((value) => (value === 'context' ? 'prompt' : value));
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [view]);
  const runs = runner.runs.filter((r) => r.pipelineId === pipeline.id);
  const latest: AgentRun | undefined = recentRun(runs);
  const continuation = runs.find((r) => continuationPlan(r, pipeline).eligible);
  const active = runs.find((r) =>
    ['queued', 'running', 'waiting_approval', 'waiting_user'].includes(
      r.status,
    ),
  );
  const running = !!active;
  // Each run owns its prompt snapshot, so the job remains editable during execution.
  const locked = !storage.ready || storage.phase === 'conflict';

  function patchPipeline(patch: Partial<Pipeline>) {
    setData((current) => ({
      ...current,
      pipelines: current.pipelines.map((p) =>
        p.id === pipeline.id ? { ...p, ...patch } : p,
      ),
    }));
    setChecked(false);
  }
  function patchStage(patch: Partial<Stage>) {
    patchPipeline({
      stages: pipeline.stages.map((s) =>
        s.id === stage.id ? { ...s, ...patch } : s,
      ),
    });
  }
  function toggle(id: string) {
    setCollapsed((current) =>
      current.includes(id)
        ? current.filter((key) => key !== id)
        : [...current, id],
    );
  }
  function selectPipeline(id: string) {
    if (sessionExpanded) toggleSessionExpanded();
    const p = data.pipelines.find((p) => p.id === id)!;
    setPipelineId(id);
    setInspectorOpen(p.stages.length > 0);
    setStageId(p.stages[0]?.id ?? '');
    setView('runs');
    setDetail('prompt');
    setChecked(false);
  }
  function addStage(at: number, values?: { name: string; prompt: string }) {
    if (locked || pipeline.stages.length >= 50) return '';
    const added = {
      id: uid(),
      name: values?.name ?? 'Новый этап',
      prompt: values?.prompt ?? '',
      agent: 'default',
      appearance: at % 4,
    };
    const stages = [...pipeline.stages];
    stages.splice(at, 0, added);
    patchPipeline({ stages });
    setStageId(added.id);
    setInspectorOpen(true);
    setDetail('prompt');
    setView('editor');
    requestAnimationFrame(() => {
      document.getElementById(`stage-${added.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return added.id;
  }
  function move(direction: number) {
    const stages = [...pipeline.stages];
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    [stages[index], stages[target]] = [stages[target], stages[index]];
    patchPipeline({ stages });
  }
  function remove() {
    const old = pipeline.stages;
    const owner = pipeline.id;
    const removedStage = stage;
    const removedIndex = index;
    patchPipeline({ stages: old.filter((s) => s.id !== stage.id) });
    setStageId('');
    setInspectorOpen(false);
    toast('Этап удалён', {
      action: {
        label: 'Отменить',
        onClick: () =>
          setData((current) => ({
            ...current,
            pipelines: current.pipelines.map((p) =>
              p.id === owner && !p.stages.some((s) => s.id === removedStage.id)
                ? {
                    ...p,
                    stages: [
                      ...p.stages.slice(0, removedIndex),
                      removedStage,
                      ...p.stages.slice(removedIndex),
                    ],
                  }
                : p,
            ),
          })),
      },
    });
  }
  async function saveRunAsJob(run: AgentRun, name: string) {
    if (locked) throw new Error('Сначала сохрани текущие правки');
    const frozen: Pipeline = {
      id: uid(),
      folderId: pipeline.folderId,
      name: name.trim(),
      description: 'План из запуска «' + run.name + '»',
      task: run.task,
      accessMode: run.accessMode,
      stages: run.stages.map((s) => ({
        id: uid(),
        name: s.name,
        agent: 'codex',
        appearance: s.appearance,
        prompt: s.allowStageCreation
          ? 'Изучи задачу и рабочую папку. Подготовь требования и контекст для уже заданных следующих этапов: ' +
            run.stages
              .slice(run.stages.indexOf(s) + 1)
              .map((next) => next.name)
              .join(' → ') +
            '. Выполни только подготовку. Передай понятное резюме следующему этапу.'
          : s.prompt,
      })),
    };
    setData((current) => ({
      ...current,
      pipelines: [...current.pipelines, frozen],
    }));
    await flushWorkspace();
    if (sessionExpanded) toggleSessionExpanded();
    setPipelineId(frozen.id);
    setStageId(frozen.stages[0]?.id || '');
    setView('editor');
    setInspectorOpen(true);
    toast.success('План сохранён как джоба');
  }
  async function startRun() {
    try {
      await flushWorkspace();
    } catch (error) {
      return toast.error((error as Error).message);
    }
    if (!pipeline.stages.length) return toast('Добавь первый этап');
    if (pipeline.stages.some((s) => !s.prompt.trim()))
      return toast.error('Добавь промпт для каждого этапа');
    setLaunchOpen(true);
  }
  async function stopRun() {
    if (!active) return;
    try {
      await runnerAction(`/runs/${active.id}/stop`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  function openCreate(
    kind: 'project' | 'folder' | 'pipeline',
    parentId?: string,
  ) {
    if (locked) return;
    setNewName('');
    setDialog({ kind, parentId });
  }
  function createItem(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked || !newName.trim() || !dialog) return;
    const id = uid();
    const name = newName.trim();
    if (dialog.kind === 'project')
      setData((current) => ({
        ...current,
        projects: [...current.projects, { id, name, color: 'blue' }],
        folders: [
          ...current.folders,
          { id: uid(), projectId: id, name: 'Пайплайны' },
        ],
      }));
    else if (dialog.kind === 'folder') {
      setData((current) => ({
        ...current,
        folders: [
          ...current.folders,
          { id, name, projectId: dialog.parentId! },
        ],
      }));
      setCollapsed((current) =>
        current.filter((key) => key !== dialog.parentId),
      );
    } else {
      setData((current) => ({
        ...current,
        pipelines: [
          ...current.pipelines,
          {
            id,
            name,
            folderId: dialog.parentId!,
            description: 'Новый рабочий процесс',
            task: '',
            stages: [],
          },
        ],
      }));
      setPipelineId(id);
      setStageId('');
      setInspectorOpen(false);
      setView('editor');
      setChecked(false);
      setCollapsed((current) =>
        current.filter((key) => key !== dialog.parentId),
      );
    }
    setDialog(null);
  }
  function status(id: string) {
    return latest?.stages.find((s) => s.id === id)?.status || 'idle';
  }
  const issues = pipeline.stages.flatMap((s, i) => [
    ...(!s.prompt.trim()
      ? [
          {
            id: s.id,
            title: `Нет промпта: ${s.name}`,
            text: 'Опиши задачу и ожидаемый результат этапа.',
          },
        ]
      : []),
    ...(pipeline.stages.slice(0, i).some((other) => other.name === s.name)
      ? [
          {
            id: s.id,
            title: 'Одинаковые названия',
            text: `Уточни название «${s.name}», чтобы различать этапы.`,
          },
        ]
      : []),
  ]);
  usePipelineTools(pipeline, locked, addStage);

  return (
    <TooltipProvider>
      <SidebarProvider
        className={'studio' + (sessionExpanded ? ' session-expanded' : '')}
        open={sidebarOpen}
        onOpenChange={(open) => {
          setSidebarOpen(open);
          if (open && sessionExpanded) setSessionExpanded(false);
        }}
        style={{ '--sidebar-width': '248px' } as CSSProperties}
      >
        <Sidebar inert={sessionExpanded || undefined}>
          <SidebarHeader className="brand-header">
            <span className="brand-mark">
              <Workflow size={20} />
            </span>
            <span className="brand-name">Pipeline</span>
            <SidebarTrigger className="sidebar-toggle" />
          </SidebarHeader>
          <SidebarContent className="navigation-content">
            <button
              className="new-pipeline-button"
              onClick={() => openCreate('pipeline', folder.id)}
            >
              <Plus size={17} />
              Новая джоба
            </button>
            <div className="nav-section-heading">
              <span>Проекты</span>
              <IconButton
                label="Новый проект"
                onClick={() => openCreate('project')}
              >
                <Plus size={15} />
              </IconButton>
            </div>
            <nav aria-label="Проекты и пайплайны">
              {data.projects.map((p) => (
                <div className="project-group" key={p.id}>
                  <div className="project-heading">
                    <button
                      className="project-toggle"
                      aria-expanded={!collapsed.includes(p.id)}
                      onClick={() => toggle(p.id)}
                    >
                      {collapsed.includes(p.id) ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                      <span className={`project-avatar ${p.color}`}>
                        {p.name[0]}
                      </span>
                      <span>{p.name}</span>
                    </button>
                    <IconButton
                      label={`Новая папка в ${p.name}`}
                      onClick={() => openCreate('folder', p.id)}
                    >
                      <Plus size={14} />
                    </IconButton>
                  </div>
                  {!collapsed.includes(p.id) &&
                    data.folders
                      .filter((f) => f.projectId === p.id)
                      .map((f) => (
                        <div className="folder-group" key={f.id}>
                          <div className="folder-heading">
                            <button
                              onClick={() => toggle(f.id)}
                              aria-expanded={!collapsed.includes(f.id)}
                            >
                              {collapsed.includes(f.id) ? (
                                <Folder size={15} />
                              ) : (
                                <FolderOpen size={15} />
                              )}
                              <span>{f.name}</span>
                              <ChevronDown size={12} />
                            </button>
                            <IconButton
                              label={`Новая джоба в ${f.name}`}
                              onClick={() => openCreate('pipeline', f.id)}
                            >
                              <Plus size={14} />
                            </IconButton>
                          </div>
                          {!collapsed.includes(f.id) && (
                            <div className="pipeline-links">
                              {data.pipelines
                                .filter((item) => item.folderId === f.id)
                                .map((item) => (
                                  <button
                                    className={`pipeline-link ${item.id === pipeline.id ? 'active' : ''}`}
                                    key={item.id}
                                    onClick={() => selectPipeline(item.id)}
                                    aria-current={
                                      item.id === pipeline.id
                                        ? 'page'
                                        : undefined
                                    }
                                  >
                                    <GitBranch size={15} />
                                    <span>{item.name}</span>
                                    {item.id === pipeline.id && <i />}
                                  </button>
                                ))}
                              {!data.pipelines.some(
                                (item) => item.folderId === f.id,
                              ) && (
                                <button
                                  className="empty-folder"
                                  onClick={() => openCreate('pipeline', f.id)}
                                >
                                  + Добавить джобу
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                </div>
              ))}
            </nav>
          </SidebarContent>
          <SidebarFooter className="sidebar-bottom">
            <div className="local-status">
              <i />
              Локальное пространство
            </div>
            <p>Джобы в браузере · запуски на ноутбуке</p>
            <div className="workspace-user">
              <span className="user-avatar">R</span>
              <div>
                <strong>Моё пространство</strong>
                <span>Личный проект</span>
              </div>
              <IconButton
                label="О прототипе"
                onClick={() =>
                  toast('Локальный прототип', {
                    description:
                      'Настоящие сессии Codex. Каждая попытка работает с отдельной копией исходников.',
                  })
                }
              >
                <CircleHelp size={17} />
              </IconButton>
            </div>
          </SidebarFooter>
        </Sidebar>

        <main
          className={
            'main-workspace' + (view === 'runs' ? ' session-workspace' : '')
          }
        >
          <header className="topbar">
            <div className="breadcrumbs">
              <SidebarTrigger className="mobile-sidebar-toggle" />
              <span className={`project-avatar small ${project.color}`}>
                {project.name[0]}
              </span>
              <span className="project-crumb">{project.name}</span>
              <ChevronRight size={13} />
              <span className="folder-crumb">{folder.name}</span>
              <ChevronRight size={13} />
              <strong>{pipeline.name}</strong>
            </div>
            <div className="topbar-actions">
              <PipelineAccess
                value={pipeline.accessMode}
                onChange={(accessMode) => patchPipeline({ accessMode })}
                disabled={locked || !runner.accessProfiles}
              />
              <WorkspaceStorage workspace={data} storage={storage} />
              <button
                className="assistant-button"
                onClick={() => {
                  setAssistant(true);
                  setChecked(false);
                }}
              >
                <Sparkles size={16} />
                Помощник
              </button>
            </div>
          </header>
          <WorkspaceStorage workspace={data} storage={storage} notice />
          <Tabs
            value={view}
            onValueChange={(value) => setView(String(value))}
            className="workspace-tabs"
          >
            <section className="pipeline-heading">
              {view === 'editor' && (
                <div className="pipeline-title-row">
                  <div className="pipeline-title">
                    <div>
                      <input
                        className="pipeline-name"
                        aria-label="Название пайплайна"
                        value={pipeline.name}
                        disabled={locked}
                        onChange={(e) =>
                          patchPipeline({ name: e.target.value })
                        }
                      />
                      <p>
                        {pipeline.description ||
                          'Из идеи в последовательность действий'}
                      </p>
                    </div>
                  </div>
                  <div className="pipeline-actions">
                    <span className="saved-state">
                      <Check size={13} />
                      {storage.phase === 'saved' ? 'Сохранено' : 'Сохраняем…'}
                    </span>
                    {running && (
                      <button className="primary-button" onClick={stopRun}>
                        <Square size={13} />
                        Остановить
                      </button>
                    )}
                    {
                      <button
                        className="primary-button"
                        onClick={startRun}
                        disabled={!pipeline.stages.length}
                      >
                        <Play size={14} fill="currentColor" />
                        {continuation ? 'Продолжить' : 'Новый запуск'}
                      </button>
                    }
                  </div>
                </div>
              )}
              <div className="workspace-tabbar">
                <TabsList className="editor-tabs" variant="line">
                  <TabsTrigger value="editor">
                    <Workflow size={15} />
                    Конструктор
                  </TabsTrigger>
                  <TabsTrigger value="runs">
                    <History size={15} />
                    Запуски
                    {runs.length > 0 && (
                      <span className="tab-count">{runs.length}</span>
                    )}
                  </TabsTrigger>
                </TabsList>
                {view === 'runs' ? (
                  <button
                    className="primary-button session-launch-button"
                    onClick={startRun}
                    disabled={!pipeline.stages.length}
                  >
                    <Play size={14} fill="currentColor" />{' '}
                    {continuation ? 'Продолжить' : 'Новый запуск'}
                  </button>
                ) : (
                  <span className="toolbar-saved">
                    <Check size={13} />{' '}
                    {storage.phase === 'saved'
                      ? 'Все изменения сохранены'
                      : storage.phase === 'saving' ||
                          storage.phase === 'pending'
                        ? 'Сохраняем…'
                        : 'Изменения не сохранены'}
                  </span>
                )}
              </div>
            </section>

            <TabsContent
              value="editor"
              className={`editor-view ${inspectorOpen && stage ? 'has-inspector' : ''}`}
            >
              <section
                className={`canvas ${compactCanvas ? 'compact-canvas' : ''}`}
                aria-label="Схема пайплайна"
              >
                <div className="canvas-heading">
                  <span>
                    <span className="canvas-live-dot" />
                    Последовательно{' '}
                    <span className="stage-total">
                      {pipeline.stages.length}
                    </span>
                  </span>
                  <span className="canvas-mode">Один этап — одна сессия</span>
                </div>
                <div className="canvas-scroll" ref={canvasRef}>
                  {pipeline.stages.length ? (
                    <div
                      className="pipeline-track"
                      style={{ zoom: displayZoom / 100 }}
                    >
                      <div className="connector endpoint first">
                        <button
                          disabled={locked}
                          onClick={() => addStage(0)}
                          aria-label="Добавить этап в начало"
                        >
                          <Plus size={15} />
                        </button>
                        <span className="endpoint-line" />
                      </div>
                      {pipeline.stages.map((s, i) => (
                        <div className="stage-and-connection" key={s.id}>
                          <div
                            className={`stage-unit palette-${stageAppearance(s)} ${inspectorOpen && stage?.id === s.id ? 'is-selected' : ''} status-${status(s.id)}`}
                          >
                            <span className="stage-number">
                              ЭТАП {String(i + 1).padStart(2, '0')}
                            </span>
                            <button
                              id={`stage-${s.id}`}
                              className="stage-orb"
                              onClick={() => {
                                setStageId(s.id);
                                setDetail('prompt');
                                setInspectorOpen(true);
                              }}
                              aria-label={`Этап ${i + 1}: ${s.name}. ${status(s.id) === 'done' ? 'Готово' : status(s.id) === 'running' ? 'Выполняется' : 'Ожидает'}`}
                              aria-pressed={inspectorOpen && stage?.id === s.id}
                            >
                              <span className="orb-inner">
                                <StageIcon index={stageAppearance(s)} />
                              </span>
                              <span className="orb-status" aria-hidden="true">
                                {status(s.id) === 'running' ? (
                                  <Loader2 className="spin" size={14} />
                                ) : status(s.id) === 'done' ? (
                                  <Check size={13} strokeWidth={2.5} />
                                ) : (
                                  <span />
                                )}
                              </span>
                            </button>
                            <button
                              className="stage-label"
                              onClick={() => {
                                setStageId(s.id);
                                setDetail('prompt');
                                setInspectorOpen(true);
                              }}
                            >
                              {s.name || 'Без названия'}
                            </button>
                            <span className="stage-subtitle">
                              {status(s.id) === 'running'
                                ? 'Выполняется…'
                                : status(s.id) === 'done'
                                  ? 'Готово'
                                  : s.agent === 'default'
                                    ? 'Новая сессия'
                                    : agentNames[s.agent]}
                            </span>
                          </div>
                          {i < pipeline.stages.length - 1 ? (
                            <div
                              className={`connector bridge ${status(s.id) === 'done' ? 'completed' : ''}`}
                            >
                              <svg
                                viewBox="0 0 96 104"
                                fill="none"
                                aria-hidden="true"
                              >
                                <path
                                  className="connection-track"
                                  d="M 0 52 H 96"
                                />
                                <path
                                  className="connection-flow"
                                  d="M 0 52 H 96"
                                />
                              </svg>
                              <button
                                disabled={locked}
                                onClick={() => addStage(i + 1)}
                                aria-label={`Добавить этап после «${s.name}»`}
                              >
                                <Plus size={14} />
                              </button>
                              <ChevronRight
                                className="connection-arrow"
                                size={12}
                              />
                            </div>
                          ) : (
                            <div className="connector endpoint last">
                              <span className="endpoint-line" />
                              <button
                                disabled={locked}
                                onClick={() => addStage(i + 1)}
                                aria-label={`Добавить этап после «${s.name}»`}
                              >
                                <Plus size={24} strokeWidth={1.5} />
                              </button>
                              <span className="add-stage-label">
                                Добавить этап
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-canvas">
                      <button
                        className="empty-stage"
                        onClick={() => addStage(0)}
                      >
                        <span>
                          <Plus size={23} />
                        </span>
                        <strong>Добавить первый этап</strong>
                        <p>Любой процесс начинается с промпта</p>
                      </button>
                    </div>
                  )}
                </div>
                <div className="canvas-footer">
                  <div className="zoom-controls">
                    <IconButton
                      label="Уменьшить"
                      onClick={() => setZoom((v) => Math.max(60, v - 10))}
                      disabled={zoom <= 60}
                    >
                      <Minus size={14} />
                    </IconButton>
                    <span>{displayZoom}%</span>
                    <IconButton
                      label="Увеличить"
                      onClick={() => setZoom((v) => Math.min(140, v + 10))}
                      disabled={zoom >= 140}
                    >
                      <Plus size={14} />
                    </IconButton>
                    <i />
                    <IconButton
                      label="Показать всю цепочку"
                      onClick={() => {
                        setZoom(100);
                        canvasRef.current?.scrollTo({
                          left: 0,
                          behavior: 'smooth',
                        });
                      }}
                    >
                      <Maximize size={14} />
                    </IconButton>
                  </div>
                  <span className="canvas-help">
                    Нажмите на этап, чтобы изменить промпт
                  </span>
                </div>
              </section>

              {stage && inspectorOpen ? (
                <section
                  className={`stage-inspector palette-${stageAppearance(stage)}`}
                  aria-label="Редактор этапа"
                >
                  <div className="inspector-heading">
                    <div className="inspector-title">
                      <span className={`stage-icon icon-${index % 3}`}>
                        <StageIcon index={stageAppearance(stage)} />
                      </span>
                      <div>
                        <span>Этап {String(index + 1).padStart(2, '0')}</span>
                        <input
                          ref={nameRef}
                          aria-label="Название этапа"
                          value={stage.name}
                          disabled={locked}
                          onChange={(e) => patchStage({ name: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="inspector-actions">
                      <IconButton
                        label="Переместить этап влево"
                        disabled={index === 0 || locked}
                        onClick={() => move(-1)}
                      >
                        <ArrowLeft size={16} />
                      </IconButton>
                      <IconButton
                        label="Переместить этап вправо"
                        disabled={
                          index === pipeline.stages.length - 1 || locked
                        }
                        onClick={() => move(1)}
                      >
                        <ArrowRight size={16} />
                      </IconButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              className="icon-button"
                              aria-label="Действия с этапом"
                            />
                          }
                        >
                          <MoreHorizontal size={18} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={locked}
                            onClick={() => {
                              const copy = {
                                ...stage,
                                appearance: stageAppearance(stage),
                                id: uid(),
                                name: `${stage.name} — копия`,
                              };
                              const stages = [...pipeline.stages];
                              stages.splice(index + 1, 0, copy);
                              patchPipeline({ stages });
                              setStageId(copy.id);
                            }}
                          >
                            <Copy size={15} />
                            Дублировать
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={locked} onClick={remove}>
                            <Trash2 size={15} />
                            Удалить этап
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <span className="inspector-divider" />
                      <IconButton
                        label="Закрыть редактор этапа"
                        onClick={() => setInspectorOpen(false)}
                      >
                        <X size={17} />
                      </IconButton>
                    </div>
                  </div>
                  <div className="inspector-body">
                    <Tabs
                      value={detail}
                      onValueChange={(value) => setDetail(String(value))}
                      className="detail-tabs"
                    >
                      <div className="detail-tabbar">
                        <TabsList variant="line">
                          <TabsTrigger value="prompt">
                            <FileText size={14} />
                            Промпт
                          </TabsTrigger>
                          <TabsTrigger value="session">
                            <MessageSquare size={14} />
                            Сессия
                            {status(stage.id) === 'done' && (
                              <i className="session-dot" />
                            )}
                          </TabsTrigger>
                          <TabsTrigger value="context" className="context-tab">
                            <Layers2 size={14} /> Контекст
                          </TabsTrigger>
                        </TabsList>
                      </div>
                      <TabsContent value="prompt" className="prompt-panel">
                        <div className="prompt-intro">
                          <span>Инструкция для агента</span>
                          <span>Markdown</span>
                        </div>
                        <label className="sr-only" htmlFor="stage-prompt">
                          Инструкция этапа
                        </label>
                        <textarea
                          id="stage-prompt"
                          className="prompt-input"
                          disabled={locked}
                          placeholder="Что должен сделать этот агент? Опишите задачу и ожидаемый результат…"
                          value={stage.prompt}
                          onChange={(e) =>
                            patchStage({ prompt: e.target.value })
                          }
                        />
                        <div className="prompt-stage-creation">
                          <div>
                            <label htmlFor="prompt-creates-stages">
                              Может создавать этапы
                            </label>
                            <p>
                              {stage.allowStageCreation
                                ? 'Агент добавит до 5 следующих шагов в отдельных сессиях.'
                                : 'Выключено: агент выполняет только этот этап.'}
                            </p>
                          </div>
                          <Switch
                            id="prompt-creates-stages"
                            checked={!!stage.allowStageCreation}
                            disabled={locked}
                            onCheckedChange={(checked) =>
                              patchStage({ allowStageCreation: checked })
                            }
                          />
                        </div>
                        <div className="prompt-footer">
                          <span>Символов: {stage.prompt.length}</span>
                        </div>
                      </TabsContent>
                      <TabsContent
                        value="context"
                        className="context-tab-panel"
                      >
                        <StageSettings
                          stage={stage}
                          pipeline={pipeline}
                          index={index}
                          locked={locked}
                          patchStage={patchStage}
                          patchPipeline={patchPipeline}
                          id="pipeline-task-mobile"
                        />
                      </TabsContent>
                      <TabsContent value="session" className="session-panel">
                        <div className="session-empty">
                          <span className="empty-icon">
                            <MessageSquare size={24} />
                          </span>
                          <h3>
                            {latest
                              ? 'Сессии этого этапа'
                              : 'Готов к первому запуску'}
                          </h3>
                          <p>
                            {latest
                              ? 'Открой запуск, чтобы увидеть команды, изменения и диалог с агентом.'
                              : 'У каждого этапа будет отдельная сессия Codex.'}
                          </p>
                          <button
                            className="secondary-button"
                            onClick={() => {
                              if (latest) {
                                setRunId(latest.id);
                                setSessionTarget({
                                  runId: latest.id,
                                  stageId: stage.id,
                                });
                                setView('runs');
                              } else void startRun();
                            }}
                          >
                            <MessageSquare size={14} />
                            {latest ? 'Открыть сессию' : 'Запустить джобу'}
                          </button>
                        </div>
                      </TabsContent>
                    </Tabs>
                    <aside
                      className="settings-panel"
                      aria-label="Настройки этапа"
                    >
                      <StageSettings
                        stage={stage}
                        pipeline={pipeline}
                        index={index}
                        locked={locked}
                        patchStage={patchStage}
                        patchPipeline={patchPipeline}
                        id="pipeline-task-desktop"
                      />
                    </aside>
                  </div>
                </section>
              ) : null}
            </TabsContent>

            <TabsContent
              value="runs"
              className="runs-view live-runs-view"
              keepMounted
            >
              <RunsPanel
                pipeline={pipeline}
                runner={runner}
                selectedId={runId}
                onSelect={setRunId}
                focusTarget={sessionTarget}
                active={view === 'runs'}
                expanded={sessionExpanded}
                onToggleExpanded={toggleSessionExpanded}
                onLaunch={startRun}
                onSaveAsJob={saveRunAsJob}
                legacyRuns={data.runs.filter(
                  (r) => r.pipelineId === pipeline.id,
                )}
              />
            </TabsContent>
          </Tabs>
          <footer className="statusbar">
            <span>
              <i />
              {runner.online
                ? 'Локальный исполнитель подключён'
                : 'Ожидание исполнителя'}
            </span>
            <span>
              {runner.connected && runner.account
                ? 'Codex · OpenAI'
                : 'Codex не подключён'}
            </span>
          </footer>
        </main>

        {launchOpen && (
          <RunLauncher
            open={launchOpen}
            onOpenChange={setLaunchOpen}
            pipeline={pipeline}
            preferredRunId={runId}
            runner={runner}
            onCreated={(r) => {
              setRunId(r.id);
              const current = r.stages[Math.min(r.cursor, r.stages.length - 1)];
              setStageId(current.id);
              setSessionTarget({ runId: r.id, stageId: current.id });
              setView('runs');
            }}
          />
        )}
        <Sheet open={assistant} onOpenChange={setAssistant}>
          <SheetContent className="assistant-sheet">
            <SheetHeader className="assistant-header">
              <Sparkles size={22} />
              <SheetTitle>Помощник по пайплайну</SheetTitle>
              <SheetDescription>
                Посмотрим, всё ли готово к запуску.
              </SheetDescription>
            </SheetHeader>
            <div className="assistant-body">
              <div className="assistant-context">
                <GitBranch size={16} />
                <span>{pipeline.name}</span>
                <span>{pipeline.stages.length} этапа</span>
              </div>
              <div className="assistant-message">
                <span className="agent-avatar">
                  <Sparkles size={17} />
                </span>
                <div>
                  <strong>Начнём со структуры</strong>
                  <p>
                    Я могу проверить пустые промпты и повторяющиеся названия в
                    этом пайплайне.
                  </p>
                  <span className="assistant-disclosure">
                    Локальная проверка · ИИ не подключён
                  </span>
                </div>
              </div>
              <button
                className="primary-button full-width"
                onClick={() => setChecked(true)}
              >
                <ScanLine size={16} />
                Проверить пайплайн
              </button>
              {checked && (
                <div aria-live="polite">
                  {!pipeline.stages.length ? (
                    <div className="advice-card">
                      <strong>Добавь первый этап</strong>
                      <p>
                        Пайплайн пока пуст. Начни с задачи для одного агента.
                      </p>
                      <button
                        onClick={() => {
                          setAssistant(false);
                          setView('editor');
                          addStage(0);
                        }}
                      >
                        Добавить этап
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  ) : issues.length ? (
                    issues.map((issue, i) => (
                      <div className="advice-card" key={`${issue.id}-${i}`}>
                        <strong>{issue.title}</strong>
                        <p>{issue.text}</p>
                        <button
                          onClick={() => {
                            setStageId(issue.id);
                            setInspectorOpen(true);
                            setView('editor');
                            setDetail('prompt');
                            setAssistant(false);
                          }}
                        >
                          Открыть этап
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="check-passed">
                      <CheckCircle2 size={22} />
                      <h3>Базовая структура в порядке</h3>
                      <p>
                        У всех этапов есть инструкции и уникальные названия.
                        Можно попробовать демо-запуск.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="assistant-future">
                <MessageSquare size={17} />
                <p>
                  Здесь можно будет обсуждать весь процесс и улучшать промпты
                  вместе с ИИ.
                </p>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <Dialog
          open={!!dialog}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <DialogContent className="create-dialog">
            <DialogHeader>
              <DialogTitle>
                {dialog?.kind === 'project'
                  ? 'Новый проект'
                  : dialog?.kind === 'folder'
                    ? 'Новая папка'
                    : 'Новая джоба'}
              </DialogTitle>
              <DialogDescription>
                {dialog?.kind === 'project'
                  ? 'Отдельное пространство для связанных процессов.'
                  : dialog?.kind === 'folder'
                    ? 'Сгруппируй пайплайны по задачам.'
                    : 'Начни с пустой цепочки и добавь свои этапы.'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={createItem}>
              <label htmlFor="new-name">Название</label>
              <input
                id="new-name"
                required
                maxLength={70}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Например, Разработка продукта"
              />
              <div className="dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setDialog(null)}
                >
                  Отмена
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!newName.trim()}
                >
                  Создать
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
