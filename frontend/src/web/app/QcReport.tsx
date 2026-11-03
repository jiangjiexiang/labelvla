import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@/ui';
import { useLeRobotData, useLeRobotSelection } from '../../react/contexts/LeRobotContext';
import { useAnnotation } from '../annotation/AnnotationContext';
import { connectServerDataset } from './serverDataset';
import { api, type DatasetRow, type QcItem } from './platform/api';
import { usePage } from './platform/usePage';

const RULE_LABEL: Record<string, string> = {
  no_box: '片段无框', missing_frame_box: '缺框帧', out_of_bounds: '框出界',
  area_jump: '面积突变', mask_missing: '轮廓缺帧',
};

export function QcReport() {
  const { initialize } = useLeRobotData();
  const { selectEpisode } = useLeRobotSelection();
  const annotation = useAnnotation();
  const [, setPage] = usePage();
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [dataset, setDataset] = useState('');
  const [items, setItems] = useState<QcItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [jumping, setJumping] = useState('');

  useEffect(() => {
    api.datasets().then((rows) => {
      setDatasets(rows);
      if (rows.length && !dataset) setDataset(rows[0].path);
    }).catch(() => setDatasets([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (ds: string) => {
    if (!ds) return;
    setError('');
    try {
      const r = await api.qc(ds);
      setItems(r.issues);
    } catch (e) { setItems([]); setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(dataset); }, [load, dataset]);

  const scan = async () => {
    if (!dataset) return;
    setBusy(true);
    setError('');
    try {
      await api.qcScan(dataset);
      // 扫描是后台任务;扫描标记消失后立即停止轮询
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await api.qc(dataset);
        setItems(r.issues);
        if (!r.scanning) break;
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const grouped = useMemo(() => {
    const m = new Map<number, QcItem[]>();
    for (const it of items) {
      const l = m.get(it.episode) ?? [];
      l.push(it);
      m.set(it.episode, l);
    }
    return m;
  }, [items]);

  const jumpTo = async (it: QcItem) => {
    setJumping(`${it.episode}:${it.frame}`);
    try {
      if (annotation?.dataset !== dataset) {
        await connectServerDataset(dataset, initialize, annotation?.setDataset);
      }
      await selectEpisode(it.episode);
      setPage(null);
      if (it.frame !== null && it.frame >= 0) {
        window.setTimeout(() => annotation?.jump(it.frame ?? 0), 800);
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setJumping(''); }
  };

  const reviewVideo = async () => {
    if (!dataset) return;
    setJumping('video'); setError('');
    try {
      await connectServerDataset(dataset, initialize, annotation?.setDataset);
      await selectEpisode(0);
      setPage(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setJumping(''); }
  };
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">质检报告</span>
        <Button size="sm" variant="outline" disabled={!dataset || !!jumping} onClick={() => void reviewVideo()}>{jumping === 'video' ? '加载视频…' : '查看视频质检'}</Button>
        <select
          className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs sm:w-auto"
          value={dataset}
          onChange={(e) => setDataset(e.target.value)}
        >
          {datasets.map((d) => <option key={d.path} value={d.path}>{d.name}</option>)}
        </select>
        <Button size="sm" className="h-8 text-xs" disabled={busy || !dataset} onClick={() => void scan()}>
          {busy ? '扫描中…(约1分钟)' : '重新扫描'}
        </Button>
        <span className="text-xs text-muted-foreground">共 {items.length} 个问题</span>
      </div>
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}

      {[...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([ep, list]) => (
        <div key={ep} className="overflow-hidden rounded-md border border-border">
          <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium">
            Episode {ep} <span className="text-muted-foreground">({list.length} 个问题)</span>
          </div>
          {list.map((it, i) => (
            <button
              key={i}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-xs hover:bg-muted/30"
              disabled={jumping !== ''}
              onClick={() => void jumpTo(it)}
            >
              <Badge variant="secondary" className={it.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>
                {RULE_LABEL[it.rule] ?? it.rule}
              </Badge>
              {it.frame !== null && it.frame >= 0 && <span className="shrink-0 tabular-nums text-muted-foreground">帧 {it.frame}</span>}
              <span className="truncate text-muted-foreground">{it.detail}</span>
              <span className="ml-auto shrink-0 text-primary">{jumping === `${it.episode}:${it.frame}` ? '跳转中…' : '查看 →'}</span>
            </button>
          ))}
        </div>
      ))}
      {items.length === 0 && !error && (
        <p className="py-10 text-center text-xs text-muted-foreground">暂无质检问题。点「重新扫描」执行质检。</p>
      )}
    </div>
  );
}
