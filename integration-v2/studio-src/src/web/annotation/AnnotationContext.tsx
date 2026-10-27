import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLeRobotData, useLeRobotPlayback, useLeRobotSelection } from '../../react/contexts/LeRobotContext';

export type Point = { frame: number; cx: number; cy: number };
export type Box = { id: number | null; x: number; y: number; width: number; height: number; label: string; keypoints: Point[] };
export type Segment = { start_frame: number; end_frame: number; text: string; bboxes: Box[] };
type Context = {
  dataset: string; setDataset: (path: string) => void; episode: number | null; currentEpisode: number | null; frame: number; length: number;
  segments: Segment[]; selected: number; select: (i: number) => void; selectedBox: number; selectBox: (i: number) => void;
  boxLabel: string; setBoxLabel: (s: string) => void; dirty: boolean; error: string; saving: boolean; track: boolean; setTrack: (b: boolean) => void;
  update: (items: Segment[]) => void; save: () => Promise<void>; pause: () => void; jump: (frame: number) => void;
};
type RangeContext = { segments: Segment[]; selected: number; active: boolean };
const AnnotationRangesContext = createContext<RangeContext | null>(null);
export const useAnnotationRanges = () => useContext(AnnotationRangesContext);
const AnnotationContext = createContext<Context | null>(null);
export const useAnnotation = () => useContext(AnnotationContext);

export function AnnotationProvider({children}: {children: ReactNode}) {
  const {selectedEpisodeIndex} = useLeRobotSelection();
  const {setPlaying, setFrameIndex} = useLeRobotPlayback();
  const {subscribeFrameIndex, getFrameIndex} = useLeRobotData();
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
  const update = (items: Segment[]) => { if (saving) {setError('正在保存，请稍候'); return;} if (episode !== selectedEpisodeIndex) {setError('请先保存上一片段的标注'); return;} setSegments(items); setError(''); setDirty(true); };
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
      } else if (e.key === 'Escape' && track) setTrack(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dataset, episode, revision, segments, dirty, saving, track]);
  const value = useMemo(() => ({dataset,setDataset,episode,currentEpisode:selectedEpisodeIndex,frame:currentFrameIndex,length,segments,selected,select,selectedBox,selectBox,boxLabel,setBoxLabel,dirty,error,saving,track,setTrack,update,save,pause:()=>setPlaying(false),jump:(frame:number)=>{setPlaying(false);setFrameIndex(frame);}}), [dataset,episode,selectedEpisodeIndex,currentFrameIndex,length,segments,selected,selectedBox,boxLabel,dirty,error,saving,track,revision,setFrameIndex,setPlaying]);
  const ranges = useMemo(() => ({segments, selected, active: !!dataset && episode !== null && episode === selectedEpisodeIndex}), [segments,selected,dataset,episode,selectedEpisodeIndex]);
  return <AnnotationRangesContext.Provider value={ranges}><AnnotationContext.Provider value={value}>{children}</AnnotationContext.Provider></AnnotationRangesContext.Provider>;
}
