// 平台后端接口封装,契约见 docs/platform-plan.md 0.2 与 docs/platform-design.md 第 3 节。
// 后端未部署(404/网络错误)时各函数抛 ApiError(404) 或返回 null,调用方退化为本地模式,
// 保证旧版 bridge.py(无认证/状态/字典接口)下标注流程不受影响。

export type Role = 'admin' | 'reviewer' | 'annotator';
export type UserInfo = { username: string; role: Role; display_name?: string | null; must_change_password?: boolean };
export type EpisodeStatus = 'untagged' | 'labeling' | 'review' | 'approved' | 'rejected';
export type StatusRecord = {
  status: EpisodeStatus;
  assignee?: string | null;
  reviewer?: string | null;
  reject_reason?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};
export type DictKind = 'skill' | 'object' | 'target' | 'adverb';
export const DICT_KINDS: DictKind[] = ['skill', 'object', 'target', 'adverb'];
export const STATUS_LIST: EpisodeStatus[] = ['untagged', 'labeling', 'review', 'approved', 'rejected'];

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req(method: string, url: string, body?: unknown) {
  const r = await fetch(
    url,
    body === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, (data && data.detail) || `HTTP ${r.status}`);
  return data;
}

function normalizeStatus(d: unknown): EpisodeStatus {
  return typeof d === 'string' && (STATUS_LIST as string[]).includes(d) ? (d as EpisodeStatus) : 'untagged';
}

function normalizeRecord(d: unknown): StatusRecord {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  return {
    status: normalizeStatus(o.status),
    assignee: (o.assignee as string) ?? null,
    reviewer: (o.reviewer as string) ?? null,
    reject_reason: (o.reject_reason as string) ?? null,
    updated_by: (o.updated_by as string) ?? null,
    updated_at: (o.updated_at as string) ?? null,
  };
}

/** ready=false 表示平台后端未部署;ready=true 且 user=null 表示未登录(由登录守卫接管)。 */
export async function fetchMe(): Promise<{ ready: boolean; user: UserInfo | null }> {
  try {
    const d = await req('GET', '/api/bridge/auth/me');
    const user = d && d.username
      ? { username: String(d.username), role: d.role as Role, display_name: d.display_name ?? null, must_change_password: !!d.must_change_password }
      : null;
    return { ready: true, user };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { ready: true, user: null };
    return { ready: false, user: null };
  }
}

export async function fetchStatus(dataset: string, episode: number): Promise<StatusRecord> {
  const d = await req('GET', `/api/bridge/status?dataset=${encodeURIComponent(dataset)}&episode=${episode}`);
  return normalizeRecord(d);
}

export async function postStatus(
  dataset: string,
  episode: number,
  status: EpisodeStatus,
  reason?: string,
): Promise<StatusRecord> {
  const d = await req('POST', '/api/bridge/status', { dataset, episode, status, reason });
  return normalizeRecord(d);
}

export async function fetchBoard(dataset: string): Promise<Record<number, EpisodeStatus>> {
  const d = await req('GET', `/api/bridge/status/board?dataset=${encodeURIComponent(dataset)}`);
  return parseBoard(d);
}

function parseBoard(d: unknown): Record<number, EpisodeStatus> {
  const out: Record<number, EpisodeStatus> = {};
  const put = (ep: unknown, st: unknown) => {
    const n = Number(ep);
    if (Number.isInteger(n) && typeof st === 'string' && (STATUS_LIST as string[]).includes(st))
      out[n] = st as EpisodeStatus;
  };
  const putItem = (it: unknown) => {
    if (it && typeof it === 'object') {
      const o = it as Record<string, unknown>;
      put(o.episode ?? o.episode_index, o.status);
    }
  };
  if (Array.isArray(d)) d.forEach(putItem);
  else if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    if (Array.isArray(o.items)) o.items.forEach(putItem);
    else if (Array.isArray(o.episodes)) o.episodes.forEach(putItem);
    else
      for (const [k, v] of Object.entries(o))
        put(k, typeof v === 'string' ? v : (v as Record<string, unknown> | null)?.status);
  }
  return out;
}

export async function fetchDict(kind: DictKind): Promise<string[]> {
  const d = await req('GET', `/api/bridge/dict?kind=${kind}`);
  return parseWords(d);
}

function parseWords(d: unknown): string[] {
  const o = d as Record<string, unknown> | null;
  const arr: unknown[] = Array.isArray(d)
    ? d
    : Array.isArray(o?.entries)
      ? (o.entries as unknown[])
      : Array.isArray(o?.words)
        ? (o.words as unknown[])
        : [];
  return arr
    .map((w) => {
      if (typeof w === 'string') return w;
      if (w && typeof w === 'object') {
        const e = w as Record<string, unknown>;
        if (e.enabled === 0 || e.enabled === false) return '';
        return String(e.name ?? '');
      }
      return '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function postDictWord(kind: DictKind, name: string): Promise<void> {
  await req('POST', `/api/bridge/dict?kind=${kind}`, { kind, name });
}
