/**
 * 平台 API 客户端:按 docs/platform-plan.md 0.2 冻结契约编写。
 * 后端(Agent A/B)未就绪时接口会 404/501,页面层自行做空态展示。
 */
import { setAuth } from './authStore';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    setAuth({ user: null, ready: true });
    throw new ApiError(401, '未登录或会话已过期');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (data as { detail?: string }).detail || `请求失败 ${r.status}`);
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

// ── 类型(契约) ──
export type Role = 'admin' | 'reviewer' | 'annotator';
export interface User {
  id: number; username: string; display_name: string; role: Role;
  disabled?: boolean; expires_at?: string | null; last_login?: string | null; created_at?: string;
  dingtalk_userid?: string;
  must_change_password?: boolean;
}
export interface LoginRecord { login_at: string; logout_at?: string | null; ip?: string; device?: string }
export type EpisodeStatus = 'untagged' | 'labeling' | 'review' | 'approved' | 'rejected';
export interface DatasetRow {
  robot_tag?: string;
  path: string; name: string; episodes: number; size_gb: number | null; cameras: number; hours: number;
  counts: Record<EpisodeStatus, number>; qc: { pass: number | null; fail: number }; updated_at?: string;
  deleted?: boolean;
}
export interface DashboardData {
  totals: { datasets: number; episodes: number; hours: number; annotations: number; annotation_hours: number };
  status_dist: Record<EpisodeStatus, number>;
  quality: { valid: number; invalid: number; error: number; pass_rate: number; fix_rate: number };
  qc: { pass: number; fail: number; not_scanned: number };
  trends: {
    data_growth: { day: string; count: number }[];
    annotation_growth: { day: string; count: number }[];
    qc_trend: { day: string; pass: number; fail: number }[];
    quality_trend: { day: string; valid: number; error: number; invalid: number }[];
  };
}
export interface QcItem { episode: number; rule: string; severity: string; detail: string; frame: number | null; created_at?: string }

export type TaskStatus = 'pending' | 'running' | 'waiting_human' | 'done' | 'failed' | 'canceled';
export type NodeStatus = 'waiting' | 'running' | 'done' | 'blocked' | 'failed' | 'skipped';
export interface TaskNode {
  task_id: number; seq: number; key: string; name: string; status: NodeStatus;
  progress: number; message?: string | null; started_at?: string | null; finished_at?: string | null;
}
export interface TaskEvent { actor?: string | null; id: number; at: string; node?: string | null; level: string; message: string }
export interface Task {
  assignee?: string | null; assignee_name?: string | null;
  reviewer?: string | null; reviewer_name?: string | null;
  id: number; name: string; dataset: string; dataset_name: string; task_type: string; task_type_label: string;
  create_mode: string; base_task_id?: number | null; description?: string | null;
  status: TaskStatus; current_node?: string | null; progress: number;
  episodes_total: number; episodes_done: number; created_by: string;
  created_at: string; started_at?: string | null; finished_at?: string | null;
  updated_at: string; error?: string | null; nodes: TaskNode[];
}
export interface TaskDetail extends Task { events: TaskEvent[] }
export interface TaskStats { total: number; running: number; pending: number; done: number; failed: number; dist: Record<string, number> }
export interface EpisodeRow {
  skipped?: boolean; skip_reason?: string | null;
  index: number; length: number; duration: string; task: string; cameras: number;
  annotated: boolean; segments: number; status: EpisodeStatus;
}
export interface VideoRow { path: string; camera: string; episode: number | null; size_mb: number; name: string }
export interface VersionRow {
  id: number; dataset: string; dataset_name: string; version: string; note: string | null;
  episodes: number; size_gb: number | null; status: string; task_id: number | null;
  manifest: string | null; created_by: string; created_at: string;
}
export interface EpisodesPayload {
  dataset: string; name: string; total: number; fps: number; cameras: string[];
  version: string; episodes: EpisodeRow[];
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待处理', running: '进行中', waiting_human: '待人工确认', done: '已完成',
  failed: '执行失败', canceled: '已取消',
};
export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  waiting: '等待中', running: '进行中', done: '已完成', blocked: '待人工',
  failed: '失败', skipped: '已跳过',
};
export const TASK_TYPE_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: 'video_annotation', label: '视频标注任务', desc: '预处理 → 人工标注 → 质检 → 打包 → 编译' },
  { value: 'preprocess', label: '数据预处理任务', desc: '预处理 → 打包' },
  { value: 'qc', label: '数据质检任务', desc: '质检 → 打包' },
];

export const STATUS_LABEL: Record<EpisodeStatus, string> = {
  untagged: '未标注', labeling: '标注中', review: '待审核', approved: '已通过', rejected: '已打回',
};
export const ROLE_LABEL: Record<Role, string> = { admin: '管理员', reviewer: '审核员', annotator: '标注员' };

// ── 接口 ──
export const api = {
  // auth
  login: (username: string, password: string) =>
    post<User>('/api/bridge/auth/login', { username, password }),
  logout: () => post<{ ok: boolean }>('/api/bridge/auth/logout'),
  me: () => get<User>('/api/bridge/auth/me'),
  changePassword: (old_password: string, new_password: string) =>
    post<{ ok: boolean }>('/api/bridge/auth/password', { old_password, new_password }),
  // users
  users: () => get<User[]>('/api/bridge/users'),
  createUser: (u: { username: string; display_name: string; password: string; role: Role; expires_at?: string | null }) =>
    post<User>('/api/bridge/users', u),
  updateUser: (id: number, u: Partial<Pick<User, 'display_name' | 'role' | 'expires_at' | 'disabled'>> & { password?: string }) =>
    patch<User>(`/api/bridge/users/${id}`, u),
  bindDingtalk: (id: number, dingtalk_userid: string) => post<{ ok: boolean }>(`/api/bridge/users/${id}/dingtalk`, { dingtalk_userid }),
  disableUser: (id: number) => post<{ ok: boolean }>(`/api/bridge/users/${id}/disable`),
  deleteUser: (id: number) => del<{ ok: boolean }>(`/api/bridge/users/${id}`),
  userLogins: (id: number) => get<LoginRecord[]>(`/api/bridge/users/${id}/logins`),
  // ledger
  datasets: async (trash = false): Promise<DatasetRow[]> => {
    const r = await get<{ datasets?: DatasetRow[]; trash?: (Partial<DatasetRow> & Pick<DatasetRow, 'path' | 'name'>)[] }>(`/api/bridge/admin/datasets${trash ? '?trash=1' : ''}`);
    if (!trash) return r.datasets ?? [];
    return (r.trash ?? []).map(row => ({
      episodes: 0,
      size_gb: 0,
      cameras: 0,
      hours: 0,
      counts: {untagged: 0, labeling: 0, review: 0, approved: 0, rejected: 0},
      qc: {pass: 0, fail: 0},
      ...row,
    }));
  },
  setRobotTag: (dataset: string, robot_tag: string) => post<{ ok: boolean }>('/api/bridge/admin/datasets/robot-tag', { dataset, robot_tag }),
  rescan: () => post<{ ok: boolean }>('/api/bridge/admin/rescan'),
  deleteDataset: (path: string) => post<{ ok: boolean }>('/api/bridge/admin/datasets/delete', { path }),
  restoreDataset: (name: string) => post<{ ok: boolean }>('/api/bridge/admin/datasets/restore', { name }),
  // dashboard
  dashboard: () => get<DashboardData>('/api/bridge/dashboard'),
  // qc
  qcScan: (dataset: string) => post<{ ok: boolean; scanning: boolean }>('/api/bridge/qc/scan', { dataset }),
  qc: (dataset: string, episode?: number) =>
    get<{ issues: QcItem[]; scanning: boolean; scanned_at: string | null }>(`/api/bridge/qc?dataset=${encodeURIComponent(dataset)}${episode !== undefined ? `&episode=${episode}` : ''}`),
  // tasks
  tasks: (params: { status?: string; q?: string; dataset?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    if (params.dataset) qs.set('dataset', params.dataset);
    const query = qs.toString();
    return get<{ tasks: Task[]; stats: TaskStats }>(`/api/bridge/tasks${query ? `?${query}` : ''}`);
  },
  task: (id: number) => get<TaskDetail>(`/api/bridge/tasks/${id}`),
  taskStats: () => get<TaskStats>('/api/bridge/tasks/stats'),
  createTask: (payload: { name: string; dataset: string; task_type: string; create_mode?: string; description?: string; assignee?: string; reviewer?: string; base_task_id?: number | null }) =>
    post<TaskDetail>('/api/bridge/tasks', payload),
  cancelTask: (id: number) => post<TaskDetail>(`/api/bridge/tasks/${id}/cancel`),
  retryTask: (id: number) => post<TaskDetail>(`/api/bridge/tasks/${id}/retry`),
  completeNode: (id: number, key: string, decision: 'approved' | 'rejected' = 'approved', reason?: string) => post<TaskDetail>(`/api/bridge/tasks/${id}/nodes/${key}/complete`, { decision, reason }),
  // episodes / videos / versions
  episodes: (dataset: string, q = '') =>
    get<EpisodesPayload>(`/api/bridge/episodes?dataset=${encodeURIComponent(dataset)}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  videos: (dataset: string) =>
    get<{ dataset: string; name: string; fps: number; videos: VideoRow[] }>(`/api/bridge/videos?dataset=${encodeURIComponent(dataset)}`),
  versions: (dataset = '') =>
    get<{ versions: VersionRow[] }>(`/api/bridge/versions${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ''}`),
};
