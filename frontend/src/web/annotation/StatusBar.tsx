import { useEffect, useState } from 'react';
import { Button } from '@/ui';
import { useAnnotation, type EpisodeStatus } from './AnnotationContext';
import { STATUS_COLORS, STATUS_LABELS } from './EpisodeStatusDot';

const ROLE_LABELS: Record<string, string> = { admin: '管理员', reviewer: '审核员', annotator: '标注员' };

/**
 * 面板顶部状态条:当前 episode 状态 + 按角色/状态可执行的流转按钮。
 * 标注员:开始标注 / 提交审核 / 打回后重提;审核员:通过 / 打回(必填原因)。
 */
export function StatusBar() {
  const a = useAnnotation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [skipError, setSkipError] = useState('');
  const [skipBusy, setSkipBusy] = useState(false);
  const [choosingSkipReason,setChoosingSkipReason]=useState(false);
  const [skipReason,setSkipReason]=useState('');
  const skipReasons=['无效采集数据','基础数据有误','画面异常','动作或姿态异常','数据不完整','任务不匹配','其他'];
  useEffect(() => { setChoosingSkipReason(false); setSkipReason(''); setSkipError(''); },[a?.dataset,a?.episode]);
  if (!a || !a.dataset || a.episode === null || a.episode !== a.currentEpisode) return null;
  const st = a.status.status;
  const role = a.user?.role;
  const canAnnotate = !a.readOnly && (!role || role === 'annotator' || role === 'admin');
  const act = (next: EpisodeStatus, r?: string) => {
    void a.setStatus(next, r);
    setRejecting(false);
    setReason('');
  };
  const saveSkip = async (skipped: boolean, selectedReason?: string) => {
    setSkipBusy(true); setSkipError('');
    try { await a.setSkipped(skipped,selectedReason); setChoosingSkipReason(false); }
    catch (e) { setSkipError(e instanceof Error ? e.message : String(e)); }
    finally { setSkipBusy(false); }
  };
  const skip = () => {
    if (a.status.skipped) {
      if (window.confirm('确认恢复这条数据的标注？')) void saveSkip(false);
    } else {
      setSkipReason(''); setChoosingSkipReason(true); setSkipError('');
    }
  };
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{backgroundColor: STATUS_COLORS[st]}} />
        <span className="text-[11px] font-medium">{a.status.skipped ? '已跳过标注' : STATUS_LABELS[st]}</span>
        {a.user && (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">
            {a.user.username} · {ROLE_LABELS[a.user.role] ?? a.user.role}
          </span>
        )}
      </div>
      {st === 'rejected' && a.status.reject_reason && (
        <p className="m-0 break-all text-[11px] text-red-500">打回原因:{a.status.reject_reason}</p>
      )}
      {a.status.skipped && <p className="text-[11px] text-amber-600">{a.status.skip_reason ? `跳过原因：${a.status.skip_reason} · ` : '未选择原因，程序质检无法通过 · '}操作人：{a.status.skip_by}</p>}
      {skipError && <p role="alert" className="text-[11px] text-red-500">{skipError}</p>}
      <div className="flex flex-wrap gap-1">
        {a.platformReady && (st !== 'approved' || a.canReview) && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={skipBusy || a.dirty} onClick={skip}>{skipBusy ? '处理中…' : a.status.skipped ? '恢复标注' : '数据不可用，跳过标注'}</Button>}
        {canAnnotate && st === 'untagged' && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('labeling')}>开始标注</Button>
        )}
        {canAnnotate && st === 'labeling' && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('review')}>提交审核</Button>
        )}
        {canAnnotate && st === 'rejected' && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('review')}>修改后重新提交</Button>
        )}
        {!a.status.skipped && a.canReview && (st === 'review' || st === 'approved') && (
          <>
            {st === 'review' && (
              <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('approved')}>通过</Button>
            )}
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] text-red-500" onClick={() => setRejecting(v => !v)}>打回</Button>
          </>
        )}
      </div>
      {a.status.skipped && role!=='reviewer' && !choosingSkipReason && <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { setSkipReason(a.status.skip_reason || ''); setChoosingSkipReason(true); }}>补充或修改未标注原因</Button>}
      {choosingSkipReason && <div className="flex flex-col gap-2 rounded border border-border p-2">
        <label className="text-[11px]">未标注原因（必选）
          <select aria-label="未标注原因" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} className="mt-1 w-full rounded border border-input bg-background p-1 text-xs">
            <option value="">请选择原因</option>
            {skipReason && !skipReasons.includes(skipReason) && <option value={skipReason}>{skipReason}</option>}
            {skipReasons.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <span className="text-[10px] text-muted-foreground">原始数据和已有标注会保留。程序质检会检查此原因。</span>
        <div className="flex gap-1"><Button size="sm" variant="outline" disabled={skipBusy} onClick={() => setChoosingSkipReason(false)}>取消</Button><Button size="sm" disabled={skipBusy || !skipReason.trim()} onClick={() => void saveSkip(true,skipReason)}>{skipBusy ? '保存中…' : '确认跳过并保存原因'}</Button></div>
      </div>}
      {rejecting && (
        <div className="flex flex-col gap-1">
          <textarea
            autoFocus
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="打回原因(必填)"
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-6 flex-1 px-2 text-[11px]" onClick={() => { setRejecting(false); setReason(''); }}>取消</Button>
            <Button size="sm" className="h-6 flex-1 px-2 text-[11px]" disabled={!reason.trim()} onClick={() => act('rejected', reason.trim())}>确认打回</Button>
          </div>
        </div>
      )}
      {!a.platformReady && (
        <p className="m-0 text-[10px] text-muted-foreground">平台后端未连接，状态仅在本地显示</p>
      )}
    </div>
  );
}
