import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLeRobotData, useLeRobotPlayback, useLeRobotSelection } from '../../react/contexts/LeRobotContext';
import { getVisualFeatureNames } from '@/core';
import { ApiError, DICT_KINDS, fetchBoard, fetchDict, fetchStatus, postDictWord, postStatus, postSkip, type DictKind, type EpisodeStatus, type StatusRecord, type UserInfo } from './platformApi';
import { useAuth } from '../app/platform/authStore';

export type { DictKind, EpisodeStatus, StatusRecord, UserInfo } from './platformApi';

export type Point = { frame: number; cx: number; cy: number };
export type Box = { id: number | null; x: number; y: number; width: number; height: number; label: string; keypoints: Point[]; camera?: string; frame_boxes?: { frame: number; x: number; y: number; w: number; h: number }[]; mask_key?: string };
// 片段扩展字段(契约 0.3):四项结构化标注 + 问题标记,由 bridge 透传合并落盘
export type SegmentProblem = { reason: string; by: string; at: string; fixed_at?: string | null };
export type Segment = { start_frame: number; end_frame: number; text: string; bboxes: Box[]; skill?: string; object?: string; target?: string; adverb?: string; problem?: SegmentProblem | null };
// 四项齐全时 text 由它们自动拼句,保持旧的纯文本读取方兼容
export function composeSegmentText(s: { skill?: string; object?: string; target?: string; adverb?: string }) {
  return [s.skill, s.object, s.target, s.adverb].map(v => (v ?? '').trim()).filter(Boolean).join(' ');
}
export type SamPoint = { frame: number; x: number; y: number; positive: boolean };
export type SamState = { mode: boolean; busy: boolean; status: string; objectId: number | null; promptFrame: number | null; propagated: boolean; progress: { done: number; total: number } | null; points: SamPoint[]; bbox: { x: number; y: number; w: number; h: number } | null; camera: string | null };
type Context = {
  dataset: string; setDataset: (path: string) => void; episode: number | null; currentEpisode: number | null; frame: number; length: number;
  segments: Segment[]; selected: number; select: (i: number) => void; selectedBox: number; selectBox: (i: number) => void;
  boxLabel: string; setBoxLabel: (s: string) => void; dirty: boolean; error: string; saving: boolean; track: boolean; setTrack: (b: boolean) => void;
  showMasks: boolean; setShowMasks: (b: boolean) => void;
  update: (items: Segment[]) => void; save: () => Promise<void>; pause: () => void; jump: (frame: number) => void;
  cameras: string[]; sam: SamState; setSamMode: (b: boolean) => void; setSamCamera: (c: string) => void;
  samPoint: (x: number, y: number, positive: boolean) => Promise<void>;
  samPropagate: () => Promise<void>; samDiscard: () => Promise<void>;
  samMaskUrl: (frame: number) => string | null;
  // ── 平台化:登录用户 / episode 状态机 / 数据字典 / 问题标注 ──
  user: UserInfo | null; platformReady: boolean; readOnly: boolean; canReview: boolean;
  setSkipped: (skipped: boolean, reason?: string) => Promise<void>;
  status: StatusRecord; setStatus: (next: EpisodeStatus, reason?: string) => Promise<void>;
  statusBoard: Record<number, EpisodeStatus>;
  dict: Record<DictKind, string[]>; addDictWord: (kind: DictKind, word: string) => void;
  markProblem: (index: number, reason: string) => void; fixProblem: (index: number) => void;
};
type RangeContext = { segments: Segment[]; selected: number; active: boolean };
const AnnotationRangesContext = createContext<RangeContext | null>(null);
export const useAnnotationRanges = () => useContext(AnnotationRangesContext);
const AnnotationContext = createContext<Context | null>(null);
export const useAnnotation = () => useContext(AnnotationContext);

export function AnnotationProvider({children}: {children: ReactNode}) {
  const {selectedEpisodeIndex} = useLeRobotSelection();
  const {setPlaying, setFrameIndex} = useLeRobotPlayback();
  const {subscribeFrameIndex, getFrameIndex, info} = useLeRobotData();
  const cameras = useMemo(() => getVisualFeatureNames(info), [info]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  useEffect(() => { setCurrentFrameIndex(getFrameIndex()); return subscribeFrameIndex(setCurrentFrameIndex); }, [subscribeFrameIndex, getFrameIndex]);
  const [dataset, setDatasetState] = useState('');
  const loadedRef = useRef<{dataset:string; episode:number} | null>(null);
  const [episode, setEpisode] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, select] = useState(-1);
  const [selectedBox, selectBox] = useState(-1);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState('missing');
  const [length, setLength] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [track, setTrack] = useState(false);
  const [boxLabel, setBoxLabel] = useState('目标');
  // ── 平台化状态:与登录守卫共享用户状态,登录/登出后无需刷新即可生效 ──
  const {user, ready: authReady, bypass} = useAuth();
  const platformReady = authReady && !bypass;
  const [statusRec, setStatusRec] = useState<StatusRecord>({status: 'untagged'});
  const [statusBoard, setStatusBoard] = useState<Record<number, EpisodeStatus>>({});
  const [dict, setDict] = useState<Record<DictKind, string[]>>({skill: [], object: [], target: [], adverb: []});
  // 审核员全程只读;标注员在「已通过」后不可再改(审核员可打回解锁)
  const readOnly = !!statusRec.skipped || user?.role === 'reviewer' || (user?.role === 'annotator' && statusRec.status === 'approved');
  const canReview = user?.role === 'reviewer' || user?.role === 'admin';
  // 当前 episode 状态:随 episode 加载重新拉取,失败退回 untagged(本地模式)
  useEffect(() => {
    setStatusRec({status: 'untagged'});
    if (!dataset || episode === null) return;
    let dead = false;
    fetchStatus(dataset, episode).then(r => { if (!dead) setStatusRec(r); }).catch(() => {});
    return () => { dead = true; };
  }, [dataset, episode]);
  // 数据集级状态看板(episode 侧栏状态点)
  const refreshBoard = useCallback(() => {
    if (!dataset) { setStatusBoard({}); return; }
    fetchBoard(dataset).then(m => setStatusBoard(m)).catch(() => {});
  }, [dataset]);
  useEffect(() => { setStatusBoard({}); refreshBoard(); }, [refreshBoard]);
  // 四类字典;后端未部署时保留本地累积(从输入新词补充)
  useEffect(() => {
    let dead = false;
    DICT_KINDS.forEach(kind => {
      fetchDict(kind).then(words => { if (!dead) setDict(d => ({...d, [kind]: words})); }).catch(() => {});
    });
    return () => { dead = true; };
  }, [dataset]);
  const setSkipped = async (skipped: boolean, reason?: string) => {
    if (!dataset || episode === null) return;
    if (dirty) throw new Error('请先保存或处理未保存的标注，再跳过数据');
    const result = await postSkip(dataset, episode, skipped, reason);
    setStatusRec(result);
    refreshBoard();
  };
  const setStatus = async (next: EpisodeStatus, reason?: string) => {
    if (!dataset || episode === null) return;
    const prev = statusRec;
    setStatusRec({...statusRec, status: next, reject_reason: next === 'rejected' ? (reason ?? '') : null, reviewer: next === 'approved' || next === 'rejected' ? (user?.username ?? null) : statusRec.reviewer});
    try {
      setStatusRec(await postStatus(dataset, episode, next, reason));
      refreshBoard();
    } catch (e) {
      // 404/网络错误 = 后端未部署,保留本地状态;其余(400/403/409)回滚并提示
      if (e instanceof ApiError && e.status >= 400 && e.status !== 404) { setStatusRec(prev); setError(e.message); }
    }
  };
  const addDictWord = (kind: DictKind, word: string) => {
    const w = word.trim();
    if (!w) return;
    setDict(d => (d[kind].includes(w) ? d : {...d, [kind]: [...d[kind], w]}));
    void postDictWord(kind, w).catch(() => {});
  };
  // ── SAM 智能分割状态 ──
  const [samMode, setSamModeState] = useState(false);
  const [samBusy, setSamBusy] = useState(false);
  const [samStatus, setSamStatus] = useState('');
  const [samObjectId, setSamObjectId] = useState<number | null>(null);
  const [samPromptFrame, setSamPromptFrame] = useState<number | null>(null);
  const [samPropagated, setSamPropagated] = useState(false);
  const [samProgress, setSamProgress] = useState<{ done: number; total: number } | null>(null);
  const [samMaskVersion, setSamMaskVersion] = useState(0);
  const [showMasks, setShowMasks] = useState(true);
  const [samPoints, setSamPoints] = useState<SamPoint[]>([]);
  const [samBBox, setSamBBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [samCameraState, setSamCameraState] = useState<string | null>(null);
  const samCam = samCameraState ?? cameras[0] ?? null;
  const maskCacheRef = useRef<Map<string, string>>(new Map());
  const clearMaskCache = (oid?: number) => {
    for (const [key, url] of maskCacheRef.current) {
      if (oid === undefined || key.startsWith(`${oid}:`)) {
        URL.revokeObjectURL(url);
        maskCacheRef.current.delete(key);
      }
    }
  };
  // 传播完成后把整段 mask 预取到浏览器内存,播放时零延迟切换
  const prefetchMasks = (oid: number, frames: number[]) => {
    if (!dataset || episode === null) return;
    let i = 0;
    const worker = async () => {
      while (i < frames.length) {
        const f = frames[i++];
        const key = `${oid}:${f}`;
        if (maskCacheRef.current.has(key)) continue;
        try {
          const r = await fetch(`/api/bridge/sam/mask/${f}/${oid}.png?dataset=${encodeURIComponent(dataset)}&episode=${episode}&camera=${encodeURIComponent(samCam ?? '')}`);
          if (r.ok) {
            maskCacheRef.current.set(key, URL.createObjectURL(await r.blob()));
            if (maskCacheRef.current.size % 25 === 0) setSamMaskVersion(v => v + 1);
          }
        } catch { /* 单帧失败跳过 */ }
      }
      setSamMaskVersion(v => v + 1);
    };
    void Promise.all([...Array(4)].map(() => worker()));
  };
  const samMaskUrl = (frame: number): string | null => {
    if (samObjectId === null || !dataset || episode === null) return null;
    return maskCacheRef.current.get(`${samObjectId}:${frame}`)
      ?? `/api/bridge/sam/mask/${frame}/${samObjectId}.png?dataset=${encodeURIComponent(dataset)}&episode=${episode}&camera=${encodeURIComponent(samCam ?? '')}`;
  };
  const samReset = () => { setSamObjectId(null); setSamPromptFrame(null); setSamPropagated(false); setSamProgress(null); setSamPoints([]); setSamBBox(null); clearMaskCache(); };
  const setSamCamera = (c: string) => { if (samBusy) return; setSamCameraState(c); samReset(); setSamStatus('已切换相机,请在该相机画面上重新点选目标'); };
  useEffect(() => { setSamModeState(false); setSamBusy(false); setSamStatus(''); setSamCameraState(null); samReset(); }, [dataset, episode]);
  const setDataset = (path: string) => { if (dirty) {setError('请先保存未保存的标注'); return;} loadedRef.current = null; setDatasetState(path); setEpisode(null); setSegments([]); setError(''); };
  useEffect(() => {
    if (!dataset || selectedEpisodeIndex === null || dirty) return;
    if (loadedRef.current?.dataset === dataset && loadedRef.current?.episode === selectedEpisodeIndex) return;
    let cancelled = false;
    setEpisode(null); select(-1); selectBox(-1); setTrack(false); setError('');
    fetch(`/api/bridge/segments?dataset=${encodeURIComponent(dataset)}&episode=${selectedEpisodeIndex}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).detail || '读取标注失败'); return r.json(); })
      .then(data => { if (!cancelled) {setSegments(data.segments); setEpisode(data.episode); setLength(data.length); setRevision(data.revision); loadedRef.current = {dataset, episode:data.episode};} })
      .catch(e => {if (!cancelled) setError(String(e.message || e));});
    return () => {cancelled = true;};
  }, [dataset, selectedEpisodeIndex, dirty]);
  useEffect(() => {
    if (episode === null || episode !== selectedEpisodeIndex) return;
    const current = segments[selected];
    if (current && currentFrameIndex >= current.start_frame && currentFrameIndex <= current.end_frame) return;
    const next = segments.findIndex(s => currentFrameIndex >= s.start_frame && currentFrameIndex <= s.end_frame);
    if (next >= 0 && next !== selected) { select(next); selectBox(-1); setTrack(false); }
  }, [currentFrameIndex, episode, selectedEpisodeIndex, selected, segments]);
  useEffect(() => { const fn = (e: BeforeUnloadEvent) => {if (dirty) e.preventDefault();}; window.addEventListener('beforeunload', fn); return () => window.removeEventListener('beforeunload', fn);}, [dirty]);
  const update = (items: Segment[]) => { if (readOnly) {setError('审核模式为只读，不能修改标注'); return;} if (saving) {setError('正在保存，请稍候'); return;} if (episode !== selectedEpisodeIndex) {setError('请先保存上一片段的标注'); return;} setSegments(items); setError(''); setDirty(true); };
  // 问题标注:标记无效片段(红色删除线),修正后记录 fixed_at
  const markProblem = (index: number, reason: string) => {
    if (!segments[index]) return;
    update(segments.map((it, i) => (i === index ? {...it, problem: {reason, by: user?.username ?? '本地', at: new Date().toISOString(), fixed_at: null}} : it)));
  };
  const fixProblem = (index: number) => {
    if (!segments[index]?.problem) return;
    update(segments.map((it, i) => (i === index && it.problem ? {...it, problem: {...it.problem, fixed_at: new Date().toISOString()}} : it)));
  };
  const save = async () => {
    if (!dataset || episode === null || !dirty || saving) return;
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/bridge/segments?dataset=${encodeURIComponent(dataset)}&episode=${episode}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision, segments})});
      const data = await r.json(); if (!r.ok) throw new Error(data.detail || '保存失败');
      setSegments(data.segments); setRevision(data.revision); setDirty(false); setError('已保存');
    } catch (e) {setError(e instanceof Error ? e.message : String(e));}
    finally {setSaving(false);}
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dataset) {
        e.preventDefault(); e.stopPropagation(); void save();
        return;
      }
      if (e.key === 'Escape' && track) { setTrack(false); return; }
      // Q=片段起点 R=片段终点 Enter=新建片段(对齐 Embodiflow 快捷键)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, button, a, [role="button"], [role="dialog"], [contenteditable="true"]')) return;
      if (!dataset || episode === null || episode !== selectedEpisodeIndex || readOnly) return;
      const key = e.key.toLowerCase();
      if (key !== 'q' && key !== 'r' && e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();
      const f = currentFrameIndex;
      if (key === 'q' || key === 'r') {
        const seg = segments[selected];
        if (!seg) { setError('请先选择片段，再设定起点/终点'); return; }
        setPlaying(false);
        const prev = segments[selected - 1], next = segments[selected + 1];
        const ns = key === 'q' ? Math.max(prev ? prev.end_frame + 1 : 0, Math.min(f, seg.end_frame)) : seg.start_frame;
        const ne = key === 'r' ? Math.min(next ? next.start_frame - 1 : length - 1, Math.max(f, seg.start_frame)) : seg.end_frame;
        if (ne < ns) return;
        update(segments.map((it, i) => (i === selected ? {...it, start_frame: ns, end_frame: ne} : it)));
        return;
      }
      // Enter:当前帧在已有片段内则选中它,否则新建零长度片段(再用 Q/R 调整起止)
      setPlaying(false);
      const inside = segments.findIndex(s => f >= s.start_frame && f <= s.end_frame);
      if (inside >= 0) { select(inside); selectBox(-1); setTrack(false); return; }
      const seg: Segment = {start_frame: f, end_frame: f, text: '', bboxes: []};
      const next = [...segments, seg].sort((a, b) => a.start_frame - b.start_frame);
      update(next);
      select(next.indexOf(seg));
      selectBox(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dataset, episode, revision, segments, dirty, saving, track, selected, currentFrameIndex, length, readOnly, selectedEpisodeIndex]);
  // ── SAM 动作 ──
  const setSamMode = (b: boolean) => {
    if (samBusy) return;
    setSamModeState(b);
    setSamStatus('');
    if (b && dataset && episode !== null) {
      setSamBusy(true);
      setSamStatus('正在建立 SAM 会话(上传视频,首次约 1~2 分钟)…');
      fetch('/api/bridge/sam/session', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({dataset, episode, camera: samCam})})
        .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'SAM 会话失败'); setSamStatus(`SAM 就绪 · ${d.camera} · 点击画面分割目标(Shift+点击=负点)`); })
        .catch(e => { setSamStatus(String(e instanceof Error ? e.message : e)); setSamModeState(false); })
        .finally(() => setSamBusy(false));
    }
  };
  const samPoint = async (x: number, y: number, positive: boolean) => {
    if (!dataset || episode === null || samBusy || !samMode) return;
    setSamBusy(true); setSamStatus('SAM 推理中…');
    const frame = currentFrameIndex;
    try {
      const r = await fetch('/api/bridge/sam/click', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({dataset, episode, camera: samCam, frame, object_id: samObjectId, points:[{x, y, positive}]})});
      const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'SAM 点击失败');
      setSamObjectId(d.object_id);
      setSamPromptFrame(f => (f === null ? frame : f));
      setSamPropagated(false);
      clearMaskCache(d.object_id);
      setSamBBox(d.bbox ? {x: d.bbox.x, y: d.bbox.y, w: d.bbox.w, h: d.bbox.h} : null);
      setSamPoints(pts => [...pts, {frame, x, y, positive}]);
      const bb = d.bbox ? ` · 框 ${Math.round(d.bbox.w)}×${Math.round(d.bbox.h)}` : '';
      setSamStatus(`对象 #${d.object_id} 已分割${bb} · 可继续加点修正,或点"传播跟踪"`);
    } catch (e) { setSamStatus(String(e instanceof Error ? e.message : e)); }
    finally { setSamBusy(false); }
  };
  const samPropagate = async () => {
    if (!dataset || episode === null || samObjectId === null || samBusy) return;
    const seg = segments[selected];
    if (!seg) { setSamStatus('请先在 Subtask 轨道选择片段'); return; }
    setSamBusy(true); setSamStatus('传播中…');
    try {
      const r = await fetch('/api/bridge/sam/propagate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({dataset, episode, camera: samCam})});
      const d = await r.json(); if (!r.ok) throw new Error(d.detail || '传播启动失败');
      for (;;) {
        await new Promise(res => setTimeout(res, 1500));
        const tr = await fetch(`/api/bridge/sam/task/${d.task_id}`);
        const t = await tr.json(); if (!tr.ok) throw new Error(t.detail || '进度查询失败');
        setSamProgress({done: t.done_frames, total: t.total_frames});
        setSamStatus(`传播中 ${t.done_frames}/${t.total_frames} 帧 · ${t.fps} fps`);
        if (t.status === 'done') break;
        if (t.status === 'failed') throw new Error(t.error || '传播失败');
      }
      const br = await fetch(`/api/bridge/sam/bboxes/${samObjectId}?dataset=${encodeURIComponent(dataset)}&episode=${episode}&camera=${encodeURIComponent(samCam ?? '')}`);
      const bd = await br.json(); if (!br.ok) throw new Error(bd.detail || '取框失败');
      const boxes = (bd.boxes || []).filter((b: {frame:number}) => b.frame >= seg.start_frame && b.frame <= seg.end_frame);
      if (!boxes.length) throw new Error('当前片段范围内没有跟踪到目标');
      const first = boxes[0];
      const maskKey = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
      const newBox: Box = {id:null, x:first.x, y:first.y, width:first.w, height:first.h, label: boxLabel.trim() || '目标', keypoints: boxes.map((b: {frame:number;x:number;y:number;w:number;h:number}) => ({frame: b.frame, cx: b.x + b.w / 2, cy: b.y + b.h / 2})), camera: samCam ?? undefined, frame_boxes: boxes.map((b: {frame:number;x:number;y:number;w:number;h:number}) => ({frame: b.frame, x: b.x, y: b.y, w: b.w, h: b.h})), mask_key: maskKey};
      update(segments.map((s, i) => (i === selected ? {...s, bboxes: [...s.bboxes, newBox]} : s)));
      selectBox(seg.bboxes.length);
      setSamPropagated(true);
      prefetchMasks(samObjectId, boxes.map((b: {frame:number}) => b.frame));
      setSamBBox(null);
      setSamStatus(`已生成目标框:${boxes.length} 帧轨迹 · 轮廓保存中…`);
      // mask 落盘(后台),之后刷新页面也能预览
      fetch('/api/bridge/sam/finalize', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({dataset, episode, camera: samCam, object_id: samObjectId, mask_key: maskKey})})
        .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.detail || '轮廓保存失败'); setSamStatus(`目标框已生成:${boxes.length} 帧轨迹 · 轮廓已存盘 ${d.saved} 帧 · Ctrl/⌘+S 保存`); })
        .catch(e => setSamStatus(`目标框已生成,但轮廓存盘失败: ${e instanceof Error ? e.message : e}`));
    } catch (e) { setSamStatus(String(e instanceof Error ? e.message : e)); }
    finally { setSamBusy(false); setSamProgress(null); }
  };
  const samDiscard = async () => {
    if (dataset && episode !== null && samObjectId !== null) {
      try { await fetch(`/api/bridge/sam/object/${samObjectId}?dataset=${encodeURIComponent(dataset)}&episode=${episode}&camera=${encodeURIComponent(samCam ?? '')}`, {method:'DELETE'}); } catch { /* 忽略 */ }
    }
    samReset(); setSamStatus('已放弃该对象,可重新点选');
  };
  const sam: SamState = {mode: samMode, busy: samBusy, status: samStatus, objectId: samObjectId, promptFrame: samPromptFrame, propagated: samPropagated, progress: samProgress, points: samPoints, bbox: samBBox, camera: samCam};
  const value = useMemo(() => ({dataset,setDataset,episode,currentEpisode:selectedEpisodeIndex,frame:currentFrameIndex,length,segments,selected,select,selectedBox,selectBox,boxLabel,setBoxLabel,dirty,error,saving,track,setTrack,update,save,pause:()=>setPlaying(false),jump:(frame:number)=>{setPlaying(false);setFrameIndex(frame);},cameras,sam,setSamMode,setSamCamera,samPoint,samPropagate,samDiscard,samMaskUrl,showMasks,setShowMasks,user,platformReady,readOnly,canReview,status:statusRec,setStatus,setSkipped,statusBoard,dict,addDictWord,markProblem,fixProblem}), [dataset,episode,selectedEpisodeIndex,currentFrameIndex,length,segments,selected,selectedBox,boxLabel,dirty,error,saving,track,revision,setFrameIndex,setPlaying,samMode,samBusy,samStatus,samObjectId,samPromptFrame,samPropagated,samProgress,samPoints,samBBox,samCam,cameras,samMaskVersion,showMasks,user,platformReady,readOnly,canReview,statusRec,statusBoard,dict]);
  const ranges = useMemo(() => ({segments, selected, active: !!dataset && episode !== null && episode === selectedEpisodeIndex}), [segments,selected,dataset,episode,selectedEpisodeIndex]);
  return <AnnotationRangesContext.Provider value={ranges}><AnnotationContext.Provider value={value}>{children}</AnnotationContext.Provider></AnnotationRangesContext.Provider>;
}
