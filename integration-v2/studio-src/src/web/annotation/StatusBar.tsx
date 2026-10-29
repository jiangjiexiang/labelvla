import { useState } from 'react';
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
  if (!a || !a.dataset || a.episode === null || a.episode !== a.currentEpisode) return null;
  const st = a.status.status;
  const role = a.user?.role;
  const canAnnotate = !a.readOnly && (!role || role === 'annotator' || role === 'admin');
  const act = (next: EpisodeStatus, r?: string) => {
    void a.setStatus(next, r);
    setRejecting(false);
    setReason('');
  };
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{backgroundColor: STATUS_COLORS[st]}} />
        <span className="text-[11px] font-medium">{STATUS_LABELS[st]}</span>
        {a.user && (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">
            {a.user.username} · {ROLE_LABELS[a.user.role] ?? a.user.role}
          </span>
        )}
      </div>
      {st === 'rejected' && a.status.reject_reason && (
        <p className="m-0 break-all text-[11px] text-red-500">打回原因:{a.status.reject_reason}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {canAnnotate && st === 'untagged' && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('labeling')}>开始标注</Button>
        )}
        {canAnnotate && st === 'labeling' && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('review')}>提交审核</Button>
        )}
        {canAnnotate && st === 'rejected' && (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('review')}>修改后重新提交</Button>
        )}
        {a.canReview && (st === 'review' || st === 'approved') && (
          <>
            {st === 'review' && (
              <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => act('approved')}>通过</Button>
            )}
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] text-red-500" onClick={() => setRejecting(v => !v)}>打回</Button>
          </>
        )}
      </div>
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
