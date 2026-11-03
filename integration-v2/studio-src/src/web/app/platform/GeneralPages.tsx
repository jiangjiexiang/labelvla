import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, Link2, Play, Plus, RefreshCw, Search, X,
} from 'lucide-react';
import {
  api, NODE_STATUS_LABEL, STATUS_LABEL, TASK_STATUS_LABEL, TASK_TYPE_OPTIONS,
  type User, type EpisodeRow, type Task, type TaskDetail, type TaskStats, type VersionRow, type VideoRow,
} from './api';
import { WorkflowBuilder, TaskWorkflowDialog } from './WorkflowEditor';
import { ProgramReport } from './ProgramReport';
import type { WorkflowCatalog, WorkflowNode } from './api';
import { usePage, useSelection } from './usePage';
import { isExpired } from './time';
import { useAuth } from './authStore';
import { useLeRobotData, useLeRobotSelection } from '../../../react/contexts/LeRobotContext';
import { useAnnotation } from '../../annotation/AnnotationContext';
import { connectServerDataset } from '../serverDataset';

// ── 通用小件 ──────────────────────────────────────────────

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 后端时间戳是容器本地时间(UTC,无时区后缀),按 UTC 解析后转浏览器本地时区展示。 */
function fmtTime(ts?: string | null): string {
  if (!ts) return '-';
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ts;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(from?: string | null, to?: string | null): string {
  if (!from) return '-';
  const parse = (t: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}Z`).getTime();
  const a = parse(from);
  const b = to ? parse(to) : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return '-';
  const s = Math.floor((b - a) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`;
}

function statusTone(status: string): string {
  if (status === 'done' || status === 'approved') return 'success';
  if (status === 'running' || status === 'labeling' || status === 'review') return 'running';
  if (status === 'failed') return 'danger';
  return '';
}

function Heading({ eyebrow, title, description, children }: {
  eyebrow: string; title: string; description: string; children?: React.ReactNode;
}) {
  return (
    <>
      <div className="g-breadcrumb"><span>{eyebrow}</span></div>
      <div className="g-heading">
        <div><h1>{title}</h1><p>{description}</p></div>
        <div className="g-heading-actions">{children}</div>
      </div>
    </>
  );
}

function EnterAnnotation({ children = '进入标注', dataset, episode, taskId }: { children?: React.ReactNode; dataset: string; episode?: number; taskId?: number }) {
  const [, setPage] = usePage();
  const [, setSelection] = useSelection();
  const { initialize, dataLoader } = useLeRobotData();
  const { selectEpisode } = useLeRobotSelection();
  const annotation = useAnnotation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enter = async () => {
    if (!dataset) { setError('任务未绑定数据集'); return; }
    setBusy(true); setError('');
    try {
      let openedDataset = dataset;
      if (taskId) {
        const response = await fetch(`/api/bridge/tasks/${taskId}/workspace`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || '创建任务副本失败');
        openedDataset = result.dataset;
      }
      if (!dataLoader || annotation?.dataset !== openedDataset) {
        await connectServerDataset(openedDataset, initialize, annotation?.setDataset);
        await selectEpisode(episode ?? 0);
      } else if (episode !== undefined) {
        await selectEpisode(episode);
      }
      setSelection({ dataset: openedDataset, episode: episode ?? 0, taskId });
      setPage(null);
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };
  return <div>
    <button className="g-button g-primary" disabled={busy || !dataset} onClick={() => void enter()}>
      {busy ? '加载数据集…' : children}<ArrowRight />
    </button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

function Progress({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  return <div className="g-progress"><div><span style={{ width: `${v}%` }} /></div><b>{v}%</b></div>;
}


/** 复制任务深链(/?task=N)。明文 HTTP 下 navigator.clipboard 不可用,回退到 execCommand。 */
function ShareTask({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${window.location.origin}/?task=${id}`;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('execCommand 复制失败');
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('复制这个链接发给同事:', url);
    }
  };
  return (
    <button className="g-button" onClick={() => void copy()}>
      {copied ? <Check /> : <Link2 />}
      {copied ? '已复制' : '复制链接'}
    </button>
  );
}

function Notice({ kind, children }: { kind: 'error' | 'info'; children: React.ReactNode }) {
  return <div className={`g-notice ${kind}`}>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="g-empty">{children}</div>;
}

/** 真实数据集列表,供各页下拉使用。 */
function useDatasets() {
  const [rows, setRows] = useState<{ path: string; name: string; episodes: number }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.datasets()
      .then((list) => {
        if (alive) setRows(list.map((d) => ({ path: d.path, name: d.name, episodes: d.episodes })));
      })
      .catch((e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, []);
  return { datasets: rows, error };
}

function DatasetPicker({ value, onChange, datasets }: {
  value: string; onChange: (v: string) => void;
  datasets: { path: string; name: string; episodes: number }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {datasets.length === 0 && <option value="">(暂无数据集)</option>}
      {datasets.map((d) => (
        <option key={d.path} value={d.path}>{d.name} · {d.episodes} Episodes</option>
      ))}
    </select>
  );
}

// ── 任务列表 ──────────────────────────────────────────────

const TABS: { key: string; label: string; match: (t: Task) => boolean }[] = [
  { key: 'all', label: '所有任务', match: () => true },
  { key: 'pending', label: '待处理', match: (t) => t.status === 'pending' },
  { key: 'running', label: '进行中', match: (t) => t.status === 'running' || t.status === 'waiting_human' },
  { key: 'done', label: '已完成', match: (t) => t.status === 'done' },
];

export function TasksPage() {
  const [, setPage] = usePage();
  const [, setSelection] = useSelection();
  const [rows, setRows] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.tasks({ q: q.trim() || undefined, status: status || undefined });
      setRows(r.tasks);
      setStats(r.stats);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => { void load(); }, [load]);

  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const visible = useMemo(() => rows.filter(current.match), [rows, current]);

  const open = (id: number) => {
    setSelection({ taskId: id });
    setPage('task-detail');
  };

  return (
    <div className="g-page">
      <div className="flex justify-end gap-2">
        <button className="g-button" onClick={() => void load()}><RefreshCw />刷新</button>
        <button className="g-button g-primary" onClick={() => setPage('task-create')}><Plus />新建任务</button>
      </div>

      <div className="g-summary">
        {([
          ['全部任务', stats?.total ?? 0],
          ['进行中', stats?.running ?? 0],
          ['待处理', stats?.pending ?? 0],
          ['已完成', stats?.done ?? 0],
        ] as [string, number][]).map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>

      {error && <Notice kind="error">任务列表加载失败:{error}</Notice>}

      <section className="g-card g-table-card">
        <div className="g-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {t.label} <span>{rows.filter(t.match).length}</span>
            </button>
          ))}
        </div>
        <div className="g-toolbar">
          <label>
            <Search />
            <input
              placeholder="搜索任务名称、ID 或数据集"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
            />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="pending">待处理</option>
            <option value="running">进行中</option>
            <option value="waiting_human">待人工确认</option>
            <option value="done">已完成</option>
            <option value="failed">执行失败</option>
            <option value="canceled">已取消</option>
          </select>
          <button className="g-button" onClick={() => { setQ(''); setStatus(''); setTab('all'); }}>重置</button>
        </div>
        <div className="g-table-wrap g-task-table-wrap">
          <table className="g-task-table">
            <thead>
              <tr>
                <th>任务 ID</th><th>任务名称</th><th>关联数据集</th><th>状态</th>
                <th>处理进度</th><th>标注负责人</th><th>审核负责人</th><th>创建人</th><th>当前节点</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => (
                <tr key={task.id}>
                  <td className="g-mono" data-label="任务 ID">{task.id}</td>
                  <td data-label="任务名称">
                    <button className="g-link g-task-name" onClick={() => open(task.id)}>{task.name}</button>
                    <small>{task.task_type_label}</small>
                  </td>
                  <td data-label="关联数据集">{task.dataset_name}</td>
                  <td data-label="状态"><span className={`g-status ${statusTone(task.status)}`}>● {TASK_STATUS_LABEL[task.status]}</span></td>
                  <td data-label="处理进度"><Progress value={task.progress} /></td>
                  <td data-label="标注负责人">{task.assignee_name || task.assignee || '未分配'}</td>
                  <td data-label="审核负责人">{task.reviewer_name || task.reviewer || '未分配'}</td>
                  <td data-label="创建人">{task.created_by || '-'}</td>
                  <td data-label="当前节点">{task.nodes.find((n) => n.key === task.current_node)?.name ?? '-'}</td>
                  <td data-label="操作">
                    <div className="g-row-actions">
                      <button className="g-link" onClick={() => open(task.id)}>查看</button>
                      {(task.status === 'running' || task.status === 'waiting_human') && <EnterAnnotation taskId={task.id} dataset={task.dataset} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <Empty>加载中…</Empty>}
          {!loading && visible.length === 0 && (
            <Empty>{tab === 'all' ? '还没有任务,点右上角「新建任务」创建第一个。' : '该分类下暂无任务。'}</Empty>
          )}
        </div>
        <div className="g-pagination">共 {visible.length} 条 <span>全部显示</span></div>
      </section>
    </div>
  );
}

// ── 新建任务 ──────────────────────────────────────────────

export function TaskCreatePage() {
  const [, setPage] = usePage();
  const [, setSelection] = useSelection();
  const { datasets, error: dsError } = useDatasets();
  const [name, setName] = useState('');
  const [dataset, setDataset] = useState('');
  const [taskType, setTaskType] = useState('video_annotation');
  const [catalog,setCatalog]=useState<WorkflowCatalog | null>(null);
  const [workflow,setWorkflow]=useState<WorkflowNode[]>([]);
  useEffect(() => { api.workflowCatalog().then(setCatalog).catch((e) => setError(`流程配置加载失败：${errText(e)}`)); },[]);
  useEffect(() => { if (catalog) setWorkflow(catalog.templates[taskType].map((node) => ({...node}))); },[catalog,taskType]);
  const [assignee, setAssignee] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [people, setPeople] = useState<User[]>([]);
  useEffect(() => {
    api.users().then((users) => setPeople(users.filter((u) => !u.disabled && !isExpired(u.expires_at))))
      .catch((e) => setError(`负责人列表加载失败：${errText(e)}`));
  }, []);
  const [createMode, setCreateMode] = useState('new');
  const [baseVersion, setBaseVersion] = useState('');
  const [versionOptions, setVersionOptions] = useState<VersionRow[]>([]);
  useEffect(() => {
    let active = true;
    setBaseVersion(''); setVersionOptions([]);
    if (dataset) api.versions(dataset).then((result) => {
      if (active) setVersionOptions(result.versions.filter((row) => !!row.dataset_path));
    }).catch((e) => { if (active) setError(errText(e)); });
    return () => { active = false; };
  }, [dataset]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!dataset && datasets.length > 0) setDataset(datasets[0].path);
  }, [datasets, dataset]);

  const selected = TASK_TYPE_OPTIONS.find((t) => t.value === taskType) ?? TASK_TYPE_OPTIONS[0];
  const flowDescription=workflow.map((node) => node.name).join(' → ');

  const submit = async () => {
    if (!dataset) { setError('请先选择数据集'); return; }
    if (workflow.some((node) => node.key==='annotate') && !assignee) { setError('请选择标注负责人'); return; }
    if (!catalog || !workflow.length) { setError('请配置任务流程'); return; }
    if (!reviewer) { setError('请选择审核负责人'); return; }
    setSubmitting(true);
    setError('');
    try {
      const created = await api.createTask({
        name: name.trim() || `${datasets.find((d) => d.path === dataset)?.name ?? '数据集'} · 数据生产`,
        dataset,
        task_type: taskType,
        workflow,
        assignee,
        reviewer,
        create_mode: createMode,
        base_version_id: baseVersion ? Number(baseVersion) : null,
        description: description.trim(),
      });
      setSelection({ taskId: created.id });
      setPage('task-detail');
    } catch (e) {
      setError(errText(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="g-page">
      <Heading eyebrow="任务管理 / 新建任务" title="新建任务" description="选择数据集与流程节点,创建后立即开始执行">
        <button className="g-button" onClick={() => setPage('tasks')}><ArrowLeft />返回任务列表</button>
      </Heading>

      {dsError && <Notice kind="error">数据集列表加载失败:{dsError}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <form className="g-card g-create-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <section>
          <div className="g-form-title"><span>1</span><div><h2>基本信息</h2><p>任务会绑定到一个真实数据集</p></div></div>
          <div className="g-form-grid">
            <label className="full">任务名称
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="留空则自动命名" />
            </label>
            <label>任务类型
              <select value={taskType} onChange={(e) => setTaskType(e.target.value)}>
                {TASK_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label>创建类型
              <select value={createMode} onChange={(e) => setCreateMode(e.target.value)}>
                <option value="new">新建</option>
                <option value="update">更新</option>
              </select>
            </label>
            <label className="full">关联数据集
              <DatasetPicker value={dataset} onChange={setDataset} datasets={datasets} />
            </label>
            <label className="full">起始版本
              <select value={baseVersion} onChange={(e) => setBaseVersion(e.target.value)}>
                <option value="">原始数据集</option>
                {versionOptions.map((row) => <option key={row.id} value={row.id}>{row.version} · {fmtTime(row.created_at)}</option>)}
              </select>
              <small>从所选数据复制任务副本，修改和发布都保留旧版本。</small>
            </label>
            <label className="full">分配给
              <select value={assignee} required={workflow.some((node) => node.key==='annotate')} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">请选择标注负责人</option>
                {people.map((u) => <option key={u.id} value={u.username}>{u.display_name || u.username}（{u.username}）</option>)}
              </select>
            </label>
            <label className="full">审核负责人
              <select value={reviewer} required onChange={(e) => setReviewer(e.target.value)}>
                <option value="">请选择审核负责人</option>
                {people.filter((u) => u.role === 'admin' || u.role === 'reviewer').map((u) => <option key={u.id} value={u.username}>{u.display_name || u.username}（{u.username}）</option>)}
              </select>
            </label>
            <label className="full">任务描述
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这批数据要做什么,备注给后续标注同学"
              />
            </label>
          </div>
        </section>

        <section>
          <div className="g-form-title"><span>2</span><div><h2>流程配置</h2><p>{flowDescription || selected.desc}</p></div></div>
          {catalog ? <WorkflowBuilder value={workflow} onChange={setWorkflow} catalog={catalog} /> : <p>正在加载可用程序…</p>}

        </section>

        <div className="g-form-actions">
          <button type="button" className="g-button" onClick={() => setPage('tasks')}>取消</button>
          <button className="g-button g-primary" type="submit" disabled={submitting || !dataset || !catalog || !workflow.length}>
            {submitting ? '创建中…' : '创建任务'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── 任务详情 ──────────────────────────────────────────────

export function TaskDetailPage() {
  const [editingWorkflow,setEditingWorkflow]=useState(false);
  const studio = useLeRobotSelection();
  const annotation = useAnnotation();
  const { user } = useAuth();
  const [, setPage] = usePage();
  const [selection] = useSelection();
  const taskId = selection.taskId;
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      setTask(await api.task(taskId));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const active = task ? ['pending', 'running', 'waiting_human'].includes(task.status) : false;
  const unsaved = !!task && !!annotation?.dataset && [task.workspace_path, task.edited_dataset].includes(annotation.dataset) &&
    (annotation.dirty || studio.trimRanges.size > 0 || studio.modifiedEpisodes.size > 0 || studio.deletedEpisodes.size > 0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { void load(); }, 2500);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const act = async (fn: () => Promise<TaskDetail>) => {
    setBusy(true);
    try {
      setTask(await fn());
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!taskId) {
    return (
      <div className="g-page">
        <Heading eyebrow="任务管理 / 任务详情" title="任务详情" description="未选择任务">
          <button className="g-button" onClick={() => setPage('tasks')}><ArrowLeft />返回</button>
        </Heading>
        <Empty>请从任务列表进入详情。</Empty>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="g-page">
        <Heading eyebrow="任务管理 / 任务详情" title="任务详情" description="加载中…">
          <button className="g-button" onClick={() => setPage('tasks')}><ArrowLeft />返回</button>
        </Heading>
        {error ? <Notice kind="error">{error}</Notice> : <Empty>加载中…</Empty>}
      </div>
    );
  }

  const doneNodes = task.nodes.filter((n) => n.status === 'done').length;
  const current = task.nodes.find((n) => n.key === task.current_node);

  return (
    <div className="g-page">
      <Heading eyebrow="任务管理 / 任务详情" title={task.name} description={`${task.task_type_label} · ${task.dataset_name}`}>
        <button className="g-button" onClick={() => setPage('tasks')}><ArrowLeft />返回</button>
        <button className="g-button" onClick={() => void load()}><RefreshCw />刷新</button>
        <ShareTask id={task.id} />
        {(user?.role==='admin' || user?.role==='reviewer') && ['waiting_human','failed'].includes(task.status) && <button className="g-button" disabled={busy} onClick={() => setEditingWorkflow(true)}>编辑流程</button>}
        {task.status==='failed' && task.nodes.some((node) => node.key==='annotate') && (user?.role==='admin' || user?.role==='reviewer' || user?.username===task.assignee) && <button className="g-button" disabled={busy} onClick={() => void act(() => api.reworkTask(task.id))}>返回标注修正</button>}
        {active && (
          <button className="g-button" disabled={busy} onClick={() => void act(() => api.cancelTask(task.id))}>取消任务</button>
        )}
        {task.status === 'failed' && (
          <button className="g-button" disabled={busy} onClick={() => void act(() => api.retryTask(task.id))}>重试</button>
        )}
        {task.status === 'waiting_human' && <EnterAnnotation taskId={task.id} dataset={task.dataset}>进入工作区</EnterAnnotation>}
        <EnterAnnotation taskId={task.id} dataset={task.dataset}>查看视频质检</EnterAnnotation>
      </Heading>

      {error && <Notice kind="error">{error}</Notice>}
      {task.error && <Notice kind="error">执行失败:{task.error}</Notice>}
      {editingWorkflow && <TaskWorkflowDialog task={task} onClose={() => setEditingWorkflow(false)} onSaved={setTask} />}
      {task.status === 'waiting_human' && (
        <Notice kind="info">任务在「{task.current_node === 'qc' ? '标注质检' : '人工标注'}」节点暂停，由指定负责人检查并确认后，才会继续后续节点。</Notice>
      )}

      <section className="g-card g-detail-overview">
        <div>
          <div className="g-card-title"><h2>基本信息</h2><span>ID {task.id}</span></div>
          <div className="g-info-grid">
            {([
              ['任务 ID', String(task.id)],
              ['创建类型', task.create_mode === 'update' ? '更新' : '新建'],
              ['任务类型', task.task_type_label],
              ['所属数据集', task.dataset_name],
              ['Episodes', String(task.episodes_total)],
              ['标注负责人', task.assignee_name || task.assignee || '未分配'],
              ['审核负责人', task.reviewer_name || task.reviewer || '未分配'],
              ['创建人', task.created_by || '-'],
              ['创建时间', fmtTime(task.created_at)],
              ['开始时间', fmtTime(task.started_at)],
              ['结束时间', fmtTime(task.finished_at)],
              ['执行时长', fmtDuration(task.started_at, task.finished_at)],
              ['任务状态', TASK_STATUS_LABEL[task.status]],
              ['描述', task.description || '-'],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label}><label>{label}</label><span>{value}</span></div>
            ))}
          </div>
        </div>
        <aside>
          <span>当前进度</span>
          <h2>{current?.name ?? (task.status === 'done' ? '已完成' : '等待开始')}</h2>
          <p>{doneNodes} / {task.nodes.length} 节点已完成</p>
          <Progress value={task.progress} />
          <dl>
            <div><dt>任务状态</dt><dd>{TASK_STATUS_LABEL[task.status]}</dd></div>
            <div><dt>当前节点</dt><dd>{current?.name ?? '-'}</dd></div>
            <div><dt>已执行</dt><dd>{fmtDuration(task.started_at, task.finished_at)}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="g-card g-node-card">
        <div className="g-card-title">
          <div><h2>节点详情</h2><p>自动节点跑完会把真实产出写回这里</p></div>
          <span>{doneNodes} / {task.nodes.length} 节点已完成</span>
        </div>
        {task.nodes.map((node) => (
          <details
            className={`g-node ${node.status === 'done' ? 'complete' : node.status === 'running' ? 'running' : ''}`}
            key={node.key}
            open={node.status === 'running' || node.status === 'blocked'}
          >
            <summary>
              <ChevronRight />
              <strong>{node.name}</strong>
              <span>节点 {node.seq + 1}</span>
              <span className={`g-status ${statusTone(node.status)}`}>● {NODE_STATUS_LABEL[node.status]}</span>
              <span>{fmtTime(node.started_at)}</span>
              <span>{node.finished_at ? fmtDuration(node.started_at, node.finished_at) : '-'}</span>
              {node.status === 'blocked' && node.key === 'annotate' && (
                <button
                  className="g-button g-primary"
                  disabled={busy || unsaved}
                  title={unsaved ? '请先在工作区保存修改' : undefined}
                  onClick={(e) => { e.preventDefault(); void act(() => api.completeNode(task.id, node.key)); }}
                >
                  完成人工标注
                </button>
              )}
            </summary>
            {node.key === 'annotate' && node.status === 'blocked' && unsaved && <Notice kind="info">工作区还有未保存的修改，请进入工作区点击「保存修改」后再提交审核。</Notice>}
            {node.key === 'qc' && node.status === 'blocked' && <div className="flex flex-wrap gap-2 p-3">
              <EnterAnnotation taskId={task.id} dataset={task.dataset}>查看视频质检</EnterAnnotation>
              {(user?.role === 'admin' || (user?.role === 'reviewer' && user.username === task.reviewer)) && <>
                <button className="g-button g-primary" disabled={busy} onClick={() => { if (window.confirm('确认已检查视频，质检通过并继续打包发布？')) void act(() => api.completeNode(task.id, 'qc')); }}>质检通过</button>
                <button className="g-button" disabled={busy} onClick={() => { const reason = window.prompt('质检打回原因（必填）'); if (reason?.trim()) void act(() => api.completeNode(task.id, 'qc', 'rejected', reason.trim())); }}>打回重标</button>
              </>}
            </div>}
            <ProgramReport node={node} />
            {node.program && <p className="g-node-program">执行程序：{node.program_name || node.program}</p>}
            <div className="g-node-detail">
              <div>
                <h3>执行进度</h3>
                <p><Progress value={node.progress} /></p>
                <span>{NODE_STATUS_LABEL[node.status]}</span>
              </div>
              <div>
                <h3>时间</h3>
                <p>{fmtTime(node.started_at)}</p>
                <span>{node.finished_at ? `结束于 ${fmtTime(node.finished_at)} · 耗时 ${fmtDuration(node.started_at, node.finished_at)}` : '尚未结束'}</span>
              </div>
              <div>
                <h3>产出</h3>
                <p className="g-node-out">{node.message || '—'}</p>
              </div>
            </div>
          </details>
        ))}
      </section>

      <section className="g-card g-table-card g-events-card">
        <div className="g-card-title"><div><h2>执行事件</h2><p>最近的流水线事件</p></div></div>
        <div className="g-table-wrap">
          <table>
            <thead><tr><th>时间</th><th>操作人</th><th>节点</th><th>级别</th><th>事件</th></tr></thead>
            <tbody>
              {task.events.map((ev) => (
                <tr key={ev.id}>
                  <td className="g-mono">{fmtTime(ev.at)}</td>
                  <td>{ev.actor === 'system' ? '系统' : (ev.actor || ev.message.match(/^人工节点由 (.+) 确认完成$/)?.[1] || '未记录')}</td>
                  <td>{ev.node || '-'}</td>
                  <td><span className={`g-status ${ev.level === 'error' ? 'danger' : ev.level === 'warn' ? 'running' : ''}`}>{ev.level}</span></td>
                  <td>{ev.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {task.events.length === 0 && <Empty>暂无事件</Empty>}
        </div>
      </section>
    </div>
  );
}

// ── Episodes ─────────────────────────────────────────────

export function EpisodesPage() {
  const [selection, setSelection] = useSelection();
  const { datasets } = useDatasets();
  const [dataset, setDataset] = useState(selection.dataset ?? '');
  const [data, setData] = useState<{ total: number; fps: number; cameras: string[]; version: string; episodes: EpisodeRow[] } | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dataset && datasets.length > 0) setDataset(selection.dataset ?? datasets[0].path);
  }, [datasets, dataset, selection.dataset]);

  const load = useCallback(async () => {
    if (!dataset) return;
    setLoading(true);
    setError('');
    try {
      const r = await api.episodes(dataset);
      setData({ total: r.total, fps: r.fps, cameras: r.cameras, version: r.version, episodes: r.episodes });
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [dataset]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const list = data?.episodes ?? [];
    const key = q.trim().toLowerCase();
    if (!key) return list;
    return list.filter((r) => String(r.index).includes(key) || r.task.toLowerCase().includes(key));
  }, [data, q]);

  const annotated = (data?.episodes ?? []).filter((r) => r.annotated).length;

  return (
    <div className="g-page">
      <Heading
        eyebrow="数据管理"
        title={dataset ? (dataset.split('/').pop() ?? 'Episodes') : 'Episodes'}
        description={data ? `${data.version} · ${data.total} Episodes · ${data.cameras.length} 相机 · ${data.fps} FPS` : '选择数据集查看 Episode'}
      >
        <DatasetPicker value={dataset} onChange={(v) => { setDataset(v); setSelection({ dataset: v }); }} datasets={datasets} />
        <EnterAnnotation dataset={dataset}>打开标注工作区</EnterAnnotation>
      </Heading>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="g-summary">
        {([
          ['Episodes', data?.total ?? 0],
          ['帧率', `${data?.fps ?? 0} FPS`],
          ['相机', data?.cameras.length ?? 0],
          ['已标注', annotated],
        ] as [string, string | number][]).map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>

      <section className="g-card g-table-card">
        <div className="g-toolbar">
          <label>
            <Search />
            <input placeholder="搜索 Episode ID 或任务描述" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button className="g-button" onClick={() => setQ('')}>重置</button>
          <button className="g-button" onClick={() => void load()}><RefreshCw />刷新</button>
        </div>
        <div className="g-table-wrap">
          <table>
            <thead>
              <tr><th>Episode</th><th>任务描述</th><th>帧数</th><th>时长</th><th>相机</th><th>标注状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.index}>
                  <td className="g-mono">episode_{String(row.index).padStart(6, '0')}</td>
                  <td>{row.task || '-'}</td>
                  <td>{row.length}</td>
                  <td>{row.duration}</td>
                  <td>{row.cameras}</td>
                  <td>
                    <span className={`g-status ${statusTone(row.status)}`}>● {row.skipped ? '已跳过标注' : STATUS_LABEL[row.status]}</span>
                    {row.skipped && <small title={row.skip_reason || undefined}>{row.skip_reason}</small>}
                    {row.segments > 0 && <small>{row.segments} 段</small>}
                  </td>
                  <td><EnterAnnotation dataset={dataset} episode={row.index} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <Empty>加载中…</Empty>}
          {!loading && rows.length === 0 && <Empty>没有匹配的 Episode</Empty>}
        </div>
        <div className="g-pagination">共 {rows.length} 条 <span>全部显示</span></div>
      </section>
    </div>
  );
}

// ── 视频库 ───────────────────────────────────────────────

export function VideosPage() {
  const [selection] = useSelection();
  const { datasets } = useDatasets();
  const [dataset, setDataset] = useState(selection.dataset ?? '');
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [playing, setPlaying] = useState<VideoRow | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dataset && datasets.length > 0) setDataset(selection.dataset ?? datasets[0].path);
  }, [datasets, dataset, selection.dataset]);

  const load = useCallback(async () => {
    if (!dataset) return;
    setLoading(true);
    setError('');
    try {
      const r = await api.videos(dataset);
      setVideos(r.videos);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [dataset]);

  useEffect(() => { void load(); }, [load]);

  const fileUrl = (v: VideoRow) =>
    `/api/bridge/file?dataset=${encodeURIComponent(dataset)}&path=${encodeURIComponent(v.path)}`;

  const shown = videos.slice(0, 24);

  return (
    <div className="g-page">
      <Heading eyebrow="标注中心" title="视频库" description="浏览数据集里的真实相机视频">
        <DatasetPicker value={dataset} onChange={setDataset} datasets={datasets} />
        <EnterAnnotation dataset={dataset}>返回标注平台</EnterAnnotation>
      </Heading>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="g-video-grid">
        {shown.map((v) => (
          <button className="g-video-card" key={v.path} onClick={() => setPlaying(v)}>
            <div className="g-video-thumb">
              <video src={fileUrl(v)} preload="metadata" muted playsInline />
              <span className="g-play"><Play /></span>
              <small>{v.size_mb} MB · {v.camera.replace('observation.images.', '')}</small>
            </div>
            <div className="g-video-info">
              <div><strong>{v.name}</strong><span className="g-status">{v.camera}</span></div>
              <p>episode {v.episode ?? '-'}</p>
              <span>{v.path}</span>
            </div>
          </button>
        ))}
      </div>

      {loading && <Empty>加载中…</Empty>}
      {!loading && shown.length === 0 && <Empty>该数据集下没有找到 mp4 视频</Empty>}
      {videos.length > shown.length && (
        <div className="g-pagination">仅显示前 {shown.length} 个,共 {videos.length} 个视频</div>
      )}

      {playing && (
        <div className="g-modal" role="dialog" onClick={() => setPlaying(null)}>
          <div className="g-modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="g-modal-head">
              <strong>{playing.name}</strong>
              <span>{playing.camera}</span>
              <button className="g-button" onClick={() => setPlaying(null)}><X />关闭</button>
            </div>
            <video src={fileUrl(playing)} controls autoPlay playsInline />
          </div>
        </div>
      )}
    </div>
  );
}

// ── 版本管理 ─────────────────────────────────────────────

export function VersionsPage() {
  const [rows, setRows] = useState<VersionRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.versions();
      setRows(r.versions);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="g-page g-version-page">
      <div className="g-version-toolbar">
        <button className="g-button" onClick={() => void load()}><RefreshCw />刷新</button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <section className="g-card g-table-card g-versions-card">
        <div className="g-card-title"><div><h2>版本记录</h2><p>所有数据集的发布记录</p></div></div>
        <div className="g-table-wrap g-version-table-wrap">
          <table className="g-version-table">
            <thead>
              <tr><th>版本</th><th>数据集</th><th>变更说明</th><th>Episodes</th><th>大小</th><th>状态</th><th>摘要</th><th>数据文件</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="版本"><strong className="g-version-number">{row.version}</strong></td>
                  <td data-label="数据集">{row.dataset_name}</td>
                  <td data-label="变更说明">{row.note || '-'}</td>
                  <td data-label="Episodes">{row.episodes}</td>
                  <td data-label="大小">{row.size_gb == null ? '-' : row.size_gb >= 1 ? `${row.size_gb.toFixed(2)} GB` : `${(row.size_gb * 1024).toFixed(2)} MB`}</td>
                  <td data-label="状态"><span className="g-status success">● {row.status}</span></td>
                  <td className="g-mono" data-label="摘要">{(row.manifest || '').slice(0, 12) || '-'}</td>
                  <td data-label="数据文件">
                    <div className="g-version-files">
                      {row.download_url ? <a className="g-link" href={row.download_url}>下载完整数据包</a> : <span className="g-version-unavailable">暂无完整数据包</span>}
                      {row.dataset_path && <details className="g-version-location">
                        <summary>存储位置</summary>
                        <code>{row.dataset_path}</code>
                      </details>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <Empty>加载中…</Empty>}
          {!loading && rows.length === 0 && <Empty>暂无版本记录</Empty>}
        </div>
      </section>
    </div>
  );
}