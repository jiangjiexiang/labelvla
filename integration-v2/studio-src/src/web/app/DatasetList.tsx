import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge, Button, Input, Tabs, TabsList, TabsTrigger } from '@/ui';
import { useLeRobotData } from '../../react/contexts/LeRobotContext';
import { useAnnotation } from '../annotation/AnnotationContext';
import { connectServerDataset } from './serverDataset';
import { api, STATUS_LABEL, type DatasetRow, type EpisodeStatus } from './platform/api';
import { groupDatasets } from './platform/datasetGroups';
import { usePage } from './platform/usePage';

const STATUS_ORDER: EpisodeStatus[] = ['untagged', 'labeling', 'review', 'approved', 'rejected'];
const STATUS_COLOR: Record<EpisodeStatus, string> = {
  untagged: 'bg-zinc-400', labeling: 'bg-blue-500', review: 'bg-amber-500',
  approved: 'bg-emerald-500', rejected: 'bg-red-500',
};

function readFilter(): string {
  return new URLSearchParams(window.location.search).get('q') ?? '';
}

function formatSize(sizeGb: number | null): string {
  return sizeGb === null ? '扫描中…' : `${sizeGb.toFixed(2)} GB`;
}

function StatusProgress({ episodes, counts }: Pick<DatasetRow, 'episodes' | 'counts'>) {
  const labeled = counts.review + counts.approved + counts.rejected;
  const pct = episodes ? Math.round((labeled / episodes) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 w-28 overflow-hidden rounded-full bg-muted">
        {STATUS_ORDER.map((status) => {
          const width = episodes ? (counts[status] / episodes) * 100 : 0;
          return width > 0
            ? <div key={status} className={`${STATUS_COLOR[status]} h-full`} style={{ width: `${width}%` }} title={`${STATUS_LABEL[status]} ${counts[status]}`} />
            : null;
        })}
      </div>
      <span className="tabular-nums text-muted-foreground">{labeled}/{episodes} ({pct}%)</span>
    </div>
  );
}

function QcBadges({ qc }: { qc: DatasetRow['qc'] }) {
  if (qc.pass === null || qc.pass + qc.fail === 0) {
    return <span className="text-muted-foreground">未质检</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {qc.pass !== null && <Badge variant="secondary" className="text-emerald-600">{qc.pass} 过</Badge>}
      {qc.fail > 0 && <Badge variant="secondary" className="text-red-600">{qc.fail} 问题</Badge>}
    </span>
  );
}

export function DatasetList() {
  const { initialize } = useLeRobotData();
  const annotation = useAnnotation();
  const [, setPage] = usePage();
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [trash, setTrash] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState(readFilter());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (trashMode: boolean) => {
    setError('');
    try {
      setRows(await api.datasets(trashMode));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(trash); }, [load, trash]);

  // 筛选条件写进 URL,可分享
  const applyFilter = (v: string) => {
    setQ(v);
    const params = new URLSearchParams(window.location.search);
    if (v) params.set('q', v); else params.delete('q');
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  };

  // 先筛选原始 part 行,再聚合;这样搜索 subtask1_50 能命中整个项目。
  const filteredRows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(kw) || row.path.toLowerCase().includes(kw));
  }, [rows, q]);

  const entries = useMemo(() => {
    if (trash) {
      return filteredRows.map((row) => ({ kind: 'dataset' as const, key: row.path, row }));
    }
    return groupDatasets(filteredRows);
  }, [filteredRows, trash]);

  const totals = useMemo(() => {
    let size: number | null = 0;
    let episodes = 0;
    let annotated = 0;
    let approved = 0;
    for (const row of filteredRows) {
      if (row.size_gb === null) size = null;
      else if (size !== null) size += row.size_gb;
      episodes += row.episodes;
      annotated += row.counts.review + row.counts.approved + row.counts.rejected;
      approved += row.counts.approved;
    }
    return { size, episodes, annotated, approved };
  }, [filteredRows]);

  const openDataset = async (path: string) => {
    setBusy(path);
    try {
      await connectServerDataset(path, initialize, annotation?.setDataset);
      setPage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const removeDataset = async (path: string) => {
    if (!window.confirm(`确认删除 ${path}?\n数据移入回收站,标注保留,可恢复。`)) return;
    setBusy(path);
    try { await api.deleteDataset(path); await load(trash); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const restoreDataset = async (path: string) => {
    setBusy(path);
    try { await api.restoreDataset(path); await load(trash); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const rescan = async () => {
    setBusy('__rescan');
    try { await api.rescan(); await load(trash); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderDatasetRow = (row: DatasetRow, child = false) => {
    const isBusy = busy === row.path;
    return (
      <tr key={row.path} className={`border-t border-border hover:bg-muted/30 ${child ? 'bg-muted/10' : ''}`}>
        <td className={`px-3 py-2 ${child ? 'pl-10' : ''}`}>
          <div className={child ? 'border-l border-border pl-3' : ''}>
            <div className="font-medium">{row.name}</div>
            <div className="max-w-[280px] truncate text-[10px] text-muted-foreground">{row.path}</div>
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{row.episodes}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.hours.toFixed(1)}h</td>
        <td className={`px-3 py-2 text-right tabular-nums ${row.size_gb === null ? 'text-muted-foreground' : ''}`} title={row.size_gb === null ? '后台容量扫描尚未完成' : undefined}>
          {formatSize(row.size_gb)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{row.cameras}</td>
        <td className="px-3 py-2"><StatusProgress episodes={row.episodes} counts={row.counts} /></td>
        <td className="px-3 py-2"><QcBadges qc={row.qc} /></td>
        <td className="px-3 py-2 text-right">
          {trash ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy === row.name} onClick={() => void restoreDataset(row.name)}>恢复</Button>
          ) : (
            <div className="flex justify-end gap-1">
              <Button size="sm" className="h-7 px-2 text-[11px]" disabled={isBusy} onClick={() => void openDataset(row.path)}>
                {isBusy ? '打开中…' : '进入标注'}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive" disabled={isBusy} onClick={() => void removeDataset(row.path)}>删除</Button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Tabs value={trash ? 'trash' : 'all'} onValueChange={(v) => setTrash(v === 'trash')}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="h-7 px-3 text-xs">全部数据集</TabsTrigger>
            <TabsTrigger value="trash" className="h-7 px-3 text-xs">回收站</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          placeholder="搜索名称 / 路径…"
          value={q}
          onChange={(e) => applyFilter(e.target.value)}
          className="h-8 w-64 text-xs"
        />
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={busy === '__rescan'} onClick={() => void rescan()}>
          {busy === '__rescan' ? '扫描中…' : '重新扫描'}
        </Button>
      </div>

      {error && <p className="m-0 text-xs text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-right font-medium">条数</th>
              <th className="px-3 py-2 text-right font-medium">时长</th>
              <th className="px-3 py-2 text-right font-medium">大小</th>
              <th className="px-3 py-2 text-right font-medium">相机</th>
              <th className="px-3 py-2 text-left font-medium">标注进度</th>
              <th className="px-3 py-2 text-left font-medium">质检</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              if (entry.kind === 'dataset') return renderDatasetRow(entry.row);

              const group = entry.group;
              const isExpanded = expandedGroups.has(group.key);
              return (
                <Fragment key={group.key}>
                  <tr className="border-t border-border bg-muted/20 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-1.5">
                        <button
                          type="button"
                          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
                          onClick={() => toggleGroup(group.key)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? '收起' : '展开'}项目 ${group.name}`}
                          title={isExpanded ? '收起项目' : '展开项目'}
                        >
                          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium">
                            {group.name}
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{group.part_count} 个 part</Badge>
                          </div>
                          <div className="max-w-[280px] truncate text-[10px] text-muted-foreground">{group.path}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{group.episodes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{group.hours.toFixed(1)}h</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${group.size_gb === null ? 'text-muted-foreground' : ''}`} title={group.size_gb === null ? '部分 part 的容量仍在扫描' : undefined}>
                      {formatSize(group.size_gb)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{group.cameras}</td>
                    <td className="px-3 py-2"><StatusProgress episodes={group.episodes} counts={group.counts} /></td>
                    <td className="px-3 py-2"><QcBadges qc={group.qc} /></td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={() => toggleGroup(group.key)} aria-expanded={isExpanded}>
                        {isExpanded ? '收起' : '展开'}
                      </Button>
                    </td>
                  </tr>
                  {isExpanded && group.rows.map((row) => renderDatasetRow(row, true))}
                </Fragment>
              );
            })}
            {entries.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                {error ? '接口未就绪或出错' : '暂无数据'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>共 {entries.length} 个项目 / {filteredRows.length} 个数据集</span>
        <span>容量合计 {totals.size === null ? '扫描中…' : `${totals.size.toFixed(2)} GB`}</span>
        <span>episode 合计 {totals.episodes}</span>
        <span>已提交审核 {totals.annotated}</span>
        <span>已通过 {totals.approved}</span>
      </div>
    </div>
  );
}