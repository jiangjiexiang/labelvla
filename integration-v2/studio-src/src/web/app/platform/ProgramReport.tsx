import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/ui';
import type { TaskNode } from './api';

type Report = { passed?: boolean; message?: string; total?: number; annotated?: number; skipped?: number; failed?: number; episodes?: {episode:number;status:string;annotations:number;reason:string;issue:string}[] };
const statusLabels: Record<string,string>={annotated:'已标注',skipped:'有原因跳过',missing_reason:'缺少原因',missing_annotation:'未标注',invalid_annotation:'标注无效'};
export function ProgramReport({ node }: { node: TaskNode }) {
  const [open,setOpen]=useState(false);
  const [onlyFailures,setOnlyFailures]=useState(true);
  const [limit,setLimit]=useState(100);
  if (!node.result_json) return null;
  let report: Report;
  try { report=JSON.parse(node.result_json); } catch { return null; }
  if (!report.episodes) return null;
  const rows=onlyFailures ? report.episodes.filter((row) => !!row.issue) : report.episodes;
  return <div className="g-program-report">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" className="g-button">查看程序质检报告</button></DialogTrigger>
      <DialogContent className="g-qc-report-dialog">
        <DialogHeader>
          <DialogTitle>程序质检报告</DialogTitle>
          <DialogDescription>{report.message || `共 ${report.total} 个 Episode，${report.failed} 个不通过`}</DialogDescription>
        </DialogHeader>
        <div className="g-qc-report-content">
          <label className="g-qc-report-filter"><input type="checkbox" checked={onlyFailures} onChange={(e) => setOnlyFailures(e.target.checked)} />只看不通过</label>
          <div className="g-qc-report-table-wrap"><table><thead><tr><th>Episode</th><th>检查结果</th><th>标注数</th><th>未标注原因</th><th>问题</th></tr></thead><tbody>
            {rows.slice(0,limit).map((row) => <tr key={row.episode}><td>{row.episode}</td><td>{statusLabels[row.status] || row.status}</td><td>{row.annotations}</td><td>{row.reason || '-'}</td><td>{row.issue || '-'}</td></tr>)}
          </tbody></table></div>
          {rows.length===0 && <p>{onlyFailures ? '没有不通过的 Episode。' : '没有 Episode 记录。'}</p>}
          {rows.length>limit && <button type="button" className="g-qc-report-close" onClick={() => setLimit(limit+100)}>继续显示</button>}
        </div>
        <DialogFooter><button type="button" className="g-qc-report-close" onClick={() => setOpen(false)}>关闭</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
