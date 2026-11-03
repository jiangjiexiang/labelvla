import type { DatasetRow, EpisodeStatus } from './api';

const PART_DIR_RE = /^part_(\d+)$/;
const STATUSES: EpisodeStatus[] = ['untagged', 'labeling', 'review', 'approved', 'rejected'];

export interface DatasetGroup {
  key: string;
  name: string;
  path: string;
  rows: DatasetRow[];
  part_count: number;
  episodes: number;
  size_gb: number | null;
  cameras: number;
  hours: number;
  counts: Record<EpisodeStatus, number>;
  qc: { pass: number | null; fail: number };
  updated_at?: string;
}

export type DatasetEntry =
  | { kind: 'group'; key: string; group: DatasetGroup }
  | { kind: 'dataset'; key: string; row: DatasetRow };

function emptyCounts(): Record<EpisodeStatus, number> {
  return { untagged: 0, labeling: 0, review: 0, approved: 0, rejected: 0 };
}

function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed || '/';
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '';
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '';
  return index === 0 ? '/' : normalized.slice(0, index);
}

function baseName(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '';
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function partNumber(path: string): number | null {
  const match = PART_DIR_RE.exec(baseName(path));
  return match ? Number(match[1]) : null;
}

function aggregateGroup(path: string, sourceRows: DatasetRow[]): DatasetGroup {
  const rows = [...sourceRows].sort((a, b) => {
    const aPart = partNumber(a.path) ?? 0;
    const bPart = partNumber(b.path) ?? 0;
    return aPart - bPart || a.path.localeCompare(b.path);
  });
  const counts = emptyCounts();
  let episodes = 0;
  let hours = 0;
  let cameras = 0;
  let size: number | null = 0;
  let qcPass: number | null = null;
  let qcFail = 0;
  let updatedAt: string | undefined;
  let updatedTime = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    episodes += row.episodes;
    hours += row.hours;
    cameras = Math.max(cameras, row.cameras);
    if (row.size_gb === null) size = null;
    else if (size !== null) size += row.size_gb;
    for (const status of STATUSES) counts[status] += row.counts[status] ?? 0;
    if (row.qc.pass !== null) qcPass = (qcPass ?? 0) + row.qc.pass;
    qcFail += row.qc.fail;
    if (row.updated_at) {
      const time = Date.parse(row.updated_at);
      if (!Number.isNaN(time) && time > updatedTime) {
        updatedAt = row.updated_at;
        updatedTime = time;
      }
    }
  }

  return {
    key: path,
    name: baseName(path) || path,
    path,
    rows,
    part_count: rows.length,
    episodes,
    size_gb: size,
    cameras,
    hours,
    counts,
    qc: { pass: qcPass, fail: qcFail },
    updated_at: updatedAt,
  };
}

/**
 * 把同一父目录下的 part_<数字> 数据集聚合成项目，其他数据集保持独立行。
 * 父目录自身若也是数据集，则不做聚合，避免把父数据集隐藏掉。
 */
export function groupDatasets(rows: DatasetRow[]): DatasetEntry[] {
  const rowPaths = new Set(rows.map((row) => normalizePath(row.path)));
  const groupedRows = new Map<string, DatasetRow[]>();

  for (const row of rows) {
    const path = normalizePath(row.path);
    if (partNumber(path) === null) continue;
    const parent = parentPath(path);
    if (!parent || rowPaths.has(parent)) continue;
    const siblings = groupedRows.get(parent);
    if (siblings) siblings.push(row);
    else groupedRows.set(parent, [row]);
  }

  const emittedGroups = new Set<string>();
  const entries: DatasetEntry[] = [];

  for (const row of rows) {
    const path = normalizePath(row.path);
    const parent = parentPath(path);
    const siblings = groupedRows.get(parent);
    if (partNumber(path) !== null && siblings) {
      if (!emittedGroups.has(parent)) {
        entries.push({ kind: 'group', key: parent, group: aggregateGroup(parent, siblings) });
        emittedGroups.add(parent);
      }
      continue;
    }
    entries.push({ kind: 'dataset', key: path, row });
  }

  return entries;
}