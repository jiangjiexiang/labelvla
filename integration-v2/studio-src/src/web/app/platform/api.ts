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
  must_change_password?: boolean;
}
export interface LoginRecord { login_at: string; logout_at?: string | null; ip?: string; device?: string }
export type EpisodeStatus = 'untagged' | 'labeling' | 'review' | 'approved' | 'rejected';
export interface DatasetRow {
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
  updateUser: (id: number, u: Partial<Pick<User, 'display_name' | 'role' | 'expires_at'>> & { password?: string }) =>
    patch<User>(`/api/bridge/users/${id}`, u),
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
  rescan: () => post<{ ok: boolean }>('/api/bridge/admin/rescan'),
  deleteDataset: (path: string) => post<{ ok: boolean }>('/api/bridge/admin/datasets/delete', { path }),
  restoreDataset: (name: string) => post<{ ok: boolean }>('/api/bridge/admin/datasets/restore', { name }),
  // dashboard
  dashboard: () => get<DashboardData>('/api/bridge/dashboard'),
  // qc
  qcScan: (dataset: string) => post<{ ok: boolean; scanning: boolean }>('/api/bridge/qc/scan', { dataset }),
  qc: (dataset: string, episode?: number) =>
    get<{ issues: QcItem[]; scanning: boolean; scanned_at: string | null }>(`/api/bridge/qc?dataset=${encodeURIComponent(dataset)}${episode !== undefined ? `&episode=${episode}` : ''}`),
};
