import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui';
import { api, type TaskDetail } from './api';

/** Explicit administrator overrides, with the observed task state and a reason. */
export function TaskFlowControl({ task, onChanged }: { task: TaskDetail; onChanged: (task: TaskDetail) => void }) {
  const [mode, setMode] = useState<'force' | 'return' | null>(null);
  const [snapshot, setSnapshot] = useState(task);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const observed = snapshot.nodes.find((node) => node.key === snapshot.current_node);
  const boundary = snapshot.status === 'done' ? Infinity : (observed?.seq ?? snapshot.nodes.find((node) => node.status !== 'done')?.seq ?? Infinity);
  const targets = snapshot.nodes.filter((node) => node.seq <= boundary);
  const open = (next: 'force' | 'return') => {
    setSnapshot(task); setMode(next); setTarget(''); setReason(''); setError('');
  };
  const submit = async () => {
    if (!reason.trim()) { setError('请填写操作原因'); return; }
    if (mode === 'return' && !target) { setError('请选择要转回的节点'); return; }
    setBusy(true); setError('');
    try {
      const payload = { reason: reason.trim(), expected_status: snapshot.status, expected_node: snapshot.current_node ?? null, expected_updated_at: snapshot.updated_at };
      const result = mode === 'force'
        ? await api.forceAdvance(task.id, payload)
        : await api.returnToNode(task.id, { ...payload, target_node: target });
      onChanged(result); setMode(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  const current = task.nodes.find((node) => node.key === task.current_node);
  return <>
    {['waiting_human', 'failed'].includes(task.status) && current?.program !== 'publish_dataset' && current?.key !== 'compile' && <button type="button" className="g-button" onClick={() => open('force')}>强制流转</button>}
    {['waiting_human', 'failed', 'done', 'canceled'].includes(task.status) && <button type="button" className="g-button" onClick={() => open('return')}>转回节点</button>}
    <Dialog open={!!mode} onOpenChange={(open) => { if (!open && !busy) setMode(null); }}>
      <DialogContent className="g-flow-control-dialog" showCloseButton={!busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{mode === 'force' ? '强制流转' : '转回节点'}</DialogTitle>
          <DialogDescription>{mode === 'force'
            ? `人工放行「${observed?.name ?? '当前节点'}」，继续执行后续流程。原检查报告保留，操作将记录到任务事件中。`
            : '选择重新开始的节点。该节点及后续流程会重新执行，已有标注保留；已发布任务会创建新版本副本。'}</DialogDescription>
        </DialogHeader>
        <div className="g-form-grid g-flow-control-form">
          {mode === 'return' && <label className="full">转回节点<select value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}><option value="">请选择节点</option>{targets.map((node) => <option key={node.key} value={node.key}>节点 {node.seq + 1} · {node.name}</option>)}</select></label>}
          <label className="full">操作原因<textarea rows={3} maxLength={500} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="请填写本次人工调整的原因" /></label>
          {error && <p className="g-flow-control-error" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <button type="button" className="g-button" disabled={busy} onClick={() => setMode(null)}>取消</button>
          <button type="button" className="g-button g-primary" disabled={busy} onClick={() => void submit()}>{busy ? '处理中…' : mode === 'force' ? '确认强制流转' : '确认转回'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
