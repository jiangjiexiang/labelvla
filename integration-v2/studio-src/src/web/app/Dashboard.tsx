import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/ui';
import { api, STATUS_LABEL, type DashboardData, type EpisodeStatus } from './platform/api';

const DONUT_COLORS = ['#3aa7ff', '#6bd9a6', '#ffd166', '#ff5a5a', '#c179ff', '#5ac8e8'];

function Donut({ title, entries, footer }: { title: string; entries: { label: string; value: number }[]; footer?: string }) {
  const total = entries.reduce((s, e) => s + e.value, 0);
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" className="text-muted" strokeWidth="14" />
          {total > 0 && entries.map((e, i) => {
            const frac = e.value / total;
            const dash = `${frac * C} ${C}`;
            const offset = -acc * C;
            acc += frac;
            return <circle key={e.label} cx="50" cy="50" r={R} fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth="14" strokeDasharray={dash} strokeDashoffset={offset} />;
          })}
        </svg>
        <div className="flex flex-col gap-1 text-xs">
          {entries.map((e, i) => (
            <div key={e.label} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span className="text-muted-foreground">{e.label}</span>
              <span className="ml-auto tabular-nums font-medium">{e.value}</span>
            </div>
          ))}
          {footer && <div className="mt-1 text-[11px] text-muted-foreground">{footer}</div>}
          {total === 0 && <div className="text-muted-foreground">暂无数据</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function Trend({ title, series }: { title: string; series: { label: string; color: string; points: number[] }[] }) {
  const W = 260, H = 64, PAD = 4;
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const n = Math.max(2, ...series.map((s) => s.points.length));
  const y = (v: number) => PAD + (1 - v / max) * (H - PAD - 4);
  const x = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {series.map((s) => (
            <polyline key={s.label} points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="1.8" />
          ))}
        </svg>
        <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
            </span>
          ))}
          <span className="ml-auto">最近 30 天</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try { setData(await api.dashboard()); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const t = data?.totals;
  const metrics = [
    { label: '数据集', value: t ? String(t.datasets) : '-' },
    { label: '数据总时长', value: t ? `${t.hours.toFixed(1)}h` : '-' },
    { label: '标注总数', value: t ? String(t.annotations) : '-' },
    { label: '标注时长', value: t ? `${t.annotation_hours.toFixed(1)}h` : '-' },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">概览</h2>
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void load()}>
          {busy ? '刷新中…' : '刷新数据'}
        </Button>
      </div>
      {error && <p className="m-0 text-xs text-destructive">{error}(后端接口未就绪时显示此提示)</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{m.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Donut
          title="标注状态分布"
          entries={(['untagged', 'labeling', 'review', 'approved', 'rejected'] as EpisodeStatus[])
            .map((s) => ({ label: STATUS_LABEL[s], value: data?.status_dist[s] ?? 0 }))}
        />
        <Donut
          title="标注质量分布"
          entries={[
            { label: '有效', value: data?.quality.valid ?? 0 },
            { label: '错误', value: data?.quality.error ?? 0 },
            { label: '无效', value: data?.quality.invalid ?? 0 },
          ]}
          footer={data ? `通过率 ${(data.quality.pass_rate * 100).toFixed(0)}% · 解决率 ${(data.quality.fix_rate * 100).toFixed(0)}%` : undefined}
        />
        <Donut
          title="质检结果"
          entries={[
            { label: '通过', value: data?.qc.pass ?? 0 },
            { label: '不通过', value: data?.qc.fail ?? 0 },
            { label: '未质检', value: data?.qc.not_scanned ?? 0 },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Trend title="数据增长趋势" series={[{ label: '新增数据', color: '#3aa7ff', points: (data?.trends.data_growth ?? []).map((p) => p.count) }]} />
        <Trend title="标注增长趋势" series={[{ label: '新增标注', color: '#6bd9a6', points: (data?.trends.annotation_growth ?? []).map((p) => p.count) }]} />
        <Trend title="质检结果趋势" series={[
          { label: '通过', color: '#6bd9a6', points: (data?.trends.qc_trend ?? []).map((p) => p.pass) },
          { label: '不通过', color: '#ff5a5a', points: (data?.trends.qc_trend ?? []).map((p) => p.fail) },
        ]} />
        <Trend title="标注质量趋势" series={[
          { label: '有效', color: '#6bd9a6', points: (data?.trends.quality_trend ?? []).map((p) => p.valid) },
          { label: '错误', color: '#ff5a5a', points: (data?.trends.quality_trend ?? []).map((p) => p.error) },
          { label: '无效', color: '#c179ff', points: (data?.trends.quality_trend ?? []).map((p) => p.invalid) },
        ]} />
      </div>
    </div>
  );
}
