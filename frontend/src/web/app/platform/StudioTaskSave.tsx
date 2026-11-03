import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui';
import { ArrowLeft, Save, Loader2, CheckCircle2 } from 'lucide-react';
import { ExportService } from '@/platform';
import { resolveSubtaskIndexFeatureKey } from '@/core';
import { ServerExportAdapter, checked } from '../../../platform/export/ServerExportAdapter';
import { useLeRobotData, useLeRobotSelection, useLeRobotSubtask } from '../../../react/contexts/LeRobotContext';
import { useAnnotation } from '../../annotation/AnnotationContext';
import { connectServerDataset } from '../serverDataset';
import { getStudioReturnPage, usePage, useSelection } from './usePage';
import { useAuth } from './authStore';

/** Save the actual exported edits before handing a task to its reviewer. */
export function StudioTaskSave() {
  const [, setPage] = usePage();
  const [selection, setSelection] = useSelection();
  const { user } = useAuth();
  const { dataLoader, info, tasks, subtasks, initialize } = useLeRobotData();
  const { effectiveEpisodes: episodesForExport, modifiedEpisodes, deletedEpisodes, trimRanges, selectEpisode, selectedEpisodeIndex } = useLeRobotSelection();
  const { overlay } = useLeRobotSubtask();
  const annotation = useAnnotation();
  const [busy, setBusy] = useState(false);
  const [taskEditable, setTaskEditable] = useState(false);
  useEffect(() => {
    let active = true;
    setTaskEditable(false);
    if (selection.taskId) fetch(`/api/bridge/tasks/${selection.taskId}`).then(checked).then((r) => r.json()).then((task) => {
      if (active) setTaskEditable(task.status === 'waiting_human' && task.current_node === 'annotate' && (user?.role === 'admin' || task.assignee === user?.username));
    }).catch(() => {});
    return () => { active = false; };
  }, [selection.taskId, user?.username, user?.role]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [percent, setPercent] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const edited = modifiedEpisodes.size > 0 || deletedEpisodes.size > 0 || trimRanges.size > 0 || overlay.size > 0 || !!annotation?.dirty;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (edited || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edited, busy]);

  const save = async (leave = false) => {
    if (busy) return;
    if (!selection.taskId || !dataLoader || !info || !annotation?.dataset) {
      if (leave) setPage(getStudioReturnPage());
      return;
    }
    setBusy(true); setError(''); setDone(false); setPercent(null); setMessage('保存标注…');
    const abort = new AbortController(); controller.current = abort;
    let draftId: string | undefined;
    let saved = false;
    /* Hold the dialog for a beat so the finished state is actually visible. */
    const settle = async () => {
      setPercent(100);
      setDone(true);
      setMessage('已保存');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    };
    try {
      if (!(await annotation.save())) throw new Error('标注尚未保存成功，请处理标注面板中的错误后重试');
      const episodes = episodesForExport.map((episode) => {
        const range = trimRanges.get(episode.episode_index);
        return { source: episode.episode_index, start: range?.startFrame ?? 0, end: range?.endFrame ?? episode.length - 1 };
      });
      const oldIndex = selectedEpisodeIndex ?? 0;
      const newIndex = Math.max(0, episodes.findIndex((ep) => ep.source === oldIndex));
      const response = await checked(await fetch(`/api/bridge/tasks/${selection.taskId}/drafts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: annotation.dataset, episodes }), signal: abort.signal,
      }));
      const created = (await response.json()) as { id: string; dataset?: string };
      draftId = created.id;
      if (created.dataset) {
        // Only annotation segments changed, so the server copied the dataset
        // itself. Skip the re-export: nothing to re-encode or upload.
        saved = true;
        setMessage('切换数据集…');
        await connectServerDataset(created.dataset, initialize, annotation.setDataset);
        await selectEpisode(newIndex);
        setSelection({ ...selection, dataset: created.dataset, episode: newIndex });
        await settle();
        if (leave) setPage(getStudioReturnPage());
        return;
      }
      const adapter = new ServerExportAdapter(draftId, abort.signal);
      const targetVersion = dataLoader.getVersionCapability().adapterVersion === 'v3.0' ? 'v3.0' : 'v2.1';
      await new ExportService(dataLoader, adapter).exportWithData(info, episodesForExport, tasks, {
        format: 'directory', targetVersion, includeData: true, includeVideos: true, compactVideos: true,
        trimRanges, signal: abort.signal, sourceSubtasks: subtasks, subtaskOverlay: new Map(),
        // Native training subtasks remain intact. Editable LabelVLA ranges are saved in segments/ by annotation.save().
        includeSubtasks: !!resolveSubtaskIndexFeatureKey(info.features),
        onProgress: (progress) => { setPercent(Math.round(progress.percent ?? 0)); setMessage(progress.message); },
      });
      saved = true;
      setMessage('切换数据集…');
      await connectServerDataset(adapter.dataset, initialize, annotation.setDataset);
      await selectEpisode(newIndex);
      setSelection({ ...selection, dataset: adapter.dataset, episode: newIndex });
      await settle();
      if (leave) setPage(getStudioReturnPage());
    } catch (e) {
      setMessage('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (draftId && !saved) await fetch(`/api/bridge/drafts/${draftId}`, { method: 'DELETE' }).catch(() => {});
      controller.current = null; setBusy(false);
    }
  };
  const canSave = !!selection.taskId && taskEditable && user?.role !== 'reviewer';
  return <>
    <div className="g-studio-task-actions">
      <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => {
        if (canSave && (edited || annotation?.dataset.includes('/.platform/workspaces/'))) void save(true);
        else setPage(getStudioReturnPage());
      }}><ArrowLeft className="h-4 w-4" /><span className="g-studio-action-label">返回数据平台</span></Button>
      {canSave && <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="g-studio-action-label">{busy ? '保存中…' : '保存修改'}</span></Button>}
      {edited && canSave && !busy && <span className="g-studio-unsaved" title="有修改未保存"><i />未保存</span>}
      {message && !busy && <span role="status">{message}</span>}
      {error && <span role="alert">{error}</span>}
    </div>
    {busy && <div className="g-studio-save-overlay" role="dialog" aria-modal="true" aria-label="正在保存数据">
      <div className={done ? 'g-save-card is-done' : 'g-save-card'}>
        <div className="g-save-head">
          {done ? <CheckCircle2 aria-hidden /> : <Loader2 className="animate-spin" aria-hidden />}
          <strong>{done ? '已保存' : '正在保存'}</strong>
        </div>
        <div className={percent === null ? 'g-save-bar is-indeterminate' : 'g-save-bar'} role="progressbar"
          aria-label="保存进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <i style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        {/* Keep both rows in place after finishing so the card does not jump. */}
        <p className="g-save-note" aria-live="polite">{done ? '' : message || '正在处理…'}</p>
        <button className={done ? 'g-save-cancel is-hidden' : 'g-save-cancel'} onClick={() => controller.current?.abort()}>取消保存</button>
      </div>
    </div>}
  </>;
}
