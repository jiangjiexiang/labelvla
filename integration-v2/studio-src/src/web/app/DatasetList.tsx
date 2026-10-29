import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, Tabs, TabsList, TabsTrigger } from '@/ui';
import { useLeRobotData } from '../../react/contexts/LeRobotContext';
import { useAnnotation } from '../annotation/AnnotationContext';
import { connectServerDataset } from './serverDataset';
import { api, STATUS_LABEL, type DatasetRow, type EpisodeStatus } from './platform/api';
import { usePage } from './platform/usePage';

const STATUS_ORDER: EpisodeStatus[] = ['untagged', 'labeling', 'review', 'approved', 'rejected'];
const STATUS_COLOR: Record<EpisodeStatus, string> = {
  untagged: 'bg-zinc-400', labeling: 'bg-blue-500', review: 'bg-amber-500',
  approved: 'bg-emerald-500', rejected: 'bg-red-500',
};

function readFilter(): string {
  return new URLSearchParams(window.location.search).get('q') ?? '';
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

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(kw) || r.path.toLowerCase().includes(kw));
  }, [rows, q]);

  const totals = useMemo(() => ({
    size: filtered.reduce((s, r) => s + (r.size_gb || 0), 0),
    episodes: filtered.reduce((s, r) => s + (r.episodes || 0), 0),
    annotated: filtered.reduce((s, r) => s + (r.counts.review + r.counts.approved + r.counts.rejected), 0),
    approved: filtered.reduce((s, r) => s + r.counts.approved, 0),
  }), [filtered]);

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
            {filtered.map((r) => {
              const labeled = r.counts.review + r.counts.approved + r.counts.rejected;
              const pct = r.episodes ? Math.round((labeled / r.episodes) * 100) : 0;
              return (
                <tr key={r.path} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="max-w-[280px] truncate text-[10px] text-muted-foreground">{r.path}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.episodes}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(r.hours ?? 0).toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(r.size_gb ?? 0).toFixed(2)} GB</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.cameras}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                        {STATUS_ORDER.map((s) => {
                          const w = r.episodes ? (r.counts[s] / r.episodes) * 100 : 0;
                          return w > 0 ? <div key={s} className={`${STATUS_COLOR[s]} h-full`} style={{ width: `${w}%` }} title={`${STATUS_LABEL[s]} ${r.counts[s]}`} /> : null;
                        })}
                      </div>
                      <span className="tabular-nums text-muted-foreground">{labeled}/{r.episodes} ({pct}%)</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.qc.pass + r.qc.fail > 0 ? (
                      <span>
                        <Badge variant="secondary" className="mr-1 text-emerald-600">{r.qc.pass} 过</Badge>
                        {r.qc.fail > 0 && <Badge variant="secondary" className="text-red-600">{r.qc.fail} 问题</Badge>}
                      </span>
                    ) : <span className="text-muted-foreground">未质检</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {trash ? (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy === r.path} onClick={() => void restoreDataset(r.path)}>恢复</Button>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" className="h-7 px-2 text-[11px]" disabled={busy === r.path} onClick={() => void openDataset(r.path)}>
                          {busy === r.path ? '打开中…' : '进入标注'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive" disabled={busy === r.path} onClick={() => void removeDataset(r.path)}>删除</Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                {error ? '接口未就绪或出错' : '暂无数据'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>共 {filtered.length} 个数据集</span>
        <span>容量合计 {totals.size.toFixed(2)} GB</span>
        <span>episode 合计 {totals.episodes}</span>
        <span>已提交审核 {totals.annotated}</span>
        <span>已通过 {totals.approved}</span>
      </div>
    </div>
  );
}
