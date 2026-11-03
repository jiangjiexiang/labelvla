import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Tabs, TabsList, TabsTrigger } from '@/ui';
import { api, STATUS_LABEL, type DatasetRow, type EpisodeStatus } from './platform/api';
import { groupDatasets } from './platform/datasetGroups';
import { usePage, useSelection } from './platform/usePage';

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
        {(['approved', 'review', 'rejected', 'labeling', 'untagged'] as EpisodeStatus[]).map((status) => {
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
  const [, setPage] = usePage();
  const [, setSelection] = useSelection();
  const [viewFolder, setViewFolder] = useState<string | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [tagTarget, setTagTarget] = useState<DatasetRow | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const robotTags = useMemo(() => [...new Set(rows.map((row) => row.robot_tag).filter((tag): tag is string => !!tag))].sort(), [rows]);
  const [trash, setTrash] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState(readFilter());

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
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  };

  // 按父目录聚合 part，数据管理展示逻辑数据集。
  const filteredRows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(kw) || row.path.toLowerCase().includes(kw) || (row.robot_tag || '').toLowerCase().includes(kw));
  }, [rows, q]);

  const entries = useMemo(() => {
    if (trash) {
      return filteredRows.map((row) => ({ kind: 'dataset' as const, key: row.path, row }));
    }
    const grouped = groupDatasets(filteredRows);
    if (viewFolder) {
      const entry = groupDatasets(rows).find((item) => item.key === viewFolder);
      if (entry?.kind === 'group') return entry.group.rows.map((row) => ({ kind: 'dataset' as const, key: row.path, row }));
    }
    return grouped;
  }, [filteredRows, trash, viewFolder, rows]);

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

  const editRobotTag = (row: DatasetRow) => { setTagTarget(row); setTagDraft(row.robot_tag || ''); };

  const saveRobotTag = async () => {
    if (!tagTarget) return;
    const row = tagTarget;
    const tag = tagDraft.trim();
    setBusy(row.path);
    try {
      const entry = groupDatasets(rows).find((item) => item.key === row.path);
      const paths = entry?.kind === 'group' ? entry.group.rows.map((part) => part.path) : [row.path];
      for (const path of paths) await api.setRobotTag(path, tag);
      await load(trash); setTagTarget(null);
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const removeDataset = async (path: string) => {
    if (!window.confirm(`确认删除 ${path}?\n仅从平台列表隐藏，可在回收站恢复；原始文件、标注和已有任务均保留。`)) return;
    setBusy(path);
    try {
      const entry = groupDatasets(rows).find((item) => item.key === path);
      const paths = entry?.kind === 'group' ? entry.group.rows.map((part) => part.path) : [path];
      for (const target of paths) await api.deleteDataset(target);
      await load(trash);
    }
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

  const viewDataset = (row: DatasetRow) => {
    const entry = groupDatasets(rows).find((item) => item.key === row.path);
    if (entry?.kind === 'group') { setViewFolder(row.path); return; }
    setSelection({ dataset: row.path }); setPage('episodes');
  };

  const renderDatasetRow = (row: DatasetRow, child = false) => {
    const isBusy = busy === row.path;
    return (
      <tr key={row.path} className={`border-t border-border hover:bg-muted/30 ${child ? 'bg-muted/10' : ''}`}>
        <td className={`px-3 py-2 ${child ? 'pl-10' : ''}`}>
          <div className={child ? 'border-l border-border pl-3' : ''}>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="font-medium text-primary hover:underline" disabled={trash} onClick={() => viewDataset(row)}>{row.name}</button>
              {trash ? (row.robot_tag && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{row.robot_tag}</Badge>) : (
                <button type="button" disabled={isBusy} onClick={() => void editRobotTag(row)} title="编辑机器人标签" aria-label={`编辑 ${row.name} 的机器人标签`} className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] leading-none text-blue-600 hover:bg-blue-100">
                  {row.robot_tag || '+ tag'}
                </button>
              )}
            </div>
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
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive" disabled={isBusy} onClick={() => void removeDataset(row.path)}>删除</Button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
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
          className="h-8 w-full text-xs sm:w-64"
        />
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={busy === '__rescan'} onClick={() => void rescan()}>
          {busy === '__rescan' ? '扫描中…' : '重新扫描'}
        </Button>
      </div>

      <Dialog open={!!error} onOpenChange={(open) => { if (!open) setError(''); }}>
        <DialogContent><DialogHeader><DialogTitle>操作未完成</DialogTitle><DialogDescription style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{error}</DialogDescription></DialogHeader><DialogFooter><button type="button" className="g-button g-primary" onClick={() => setError('')}>知道了</button></DialogFooter></DialogContent>
      </Dialog>

      {viewFolder && !trash && <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => setViewFolder(null)}>返回数据集</Button>
        <strong>{viewFolder.split('/').pop()}</strong>
        <span className="text-xs text-muted-foreground">内部数据分片，点击名称查看 Episode 和视频</span>
      </div>}
      <div className="overflow-x-auto rounded-md border border-border">
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
              const tags = [...new Set(group.rows.map((row) => row.robot_tag).filter(Boolean))];
              return renderDatasetRow({ ...group, robot_tag: tags.length === 1 ? tags[0] : undefined });
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
        <span>共 {entries.length} 个数据集</span>
        <span>容量合计 {totals.size === null ? '扫描中…' : `${totals.size.toFixed(2)} GB`}</span>
        <span>episode 合计 {totals.episodes}</span>
        <span>已提交审核 {totals.annotated}</span>
        <span>已通过 {totals.approved}</span>
      </div>
      <Dialog open={!!tagTarget} onOpenChange={(open) => { if (!open) setTagTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>机器人标签</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{tagTarget?.name}</p>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void saveRobotTag(); }}>
            <Input aria-label="机器人标签" placeholder="输入新标签，或点击下方已有标签" maxLength={80} value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
            {robotTags.length > 0 && <div className="flex flex-wrap gap-2">{robotTags.map((tag) => (
              <Button key={tag} type="button" size="sm" variant={tagDraft === tag ? 'secondary' : 'outline'} onClick={() => setTagDraft(tag)}>{tag}</Button>
            ))}</div>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTagDraft('')}>清除</Button>
              <Button type="button" variant="outline" onClick={() => setTagTarget(null)}>取消</Button>
              <Button type="submit" disabled={!!busy}>{busy ? '保存中…' : '保存'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}