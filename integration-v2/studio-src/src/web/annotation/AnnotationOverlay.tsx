import { useEffect, useRef, useState } from 'react';
import { useAnnotation, type Box } from './AnnotationContext';

type XY = {x:number;y:number};
function center(box: Box, frame: number) {
  const k = [...box.keypoints].sort((a,b)=>a.frame-b.frame);
  if (!k.length) return {x:box.x+box.width/2,y:box.y+box.height/2};
  if(frame<=k[0].frame) return {x:k[0].cx,y:k[0].cy};
  if(frame>=k[k.length-1].frame) return {x:k[k.length-1].cx,y:k[k.length-1].cy};
  for(let i=0;i<k.length-1;i++) if(frame>=k[i].frame && frame<=k[i+1].frame) {const t=(frame-k[i].frame)/(k[i+1].frame-k[i].frame);return {x:k[i].cx+t*(k[i+1].cx-k[i].cx),y:k[i].cy+t*(k[i+1].cy-k[i].cy)};}
  return {x:box.x+box.width/2,y:box.y+box.height/2};
}
function frameBox(box: Box, frame: number): {x:number;y:number;w:number;h:number} {
  // SAM 生成的框带逐帧 frame_boxes,物体远近变化时大小也跟着变;
  // 手动框没有,退回"中心插值 + 固定宽高"的老逻辑。
  const fb = box.frame_boxes;
  if (fb && fb.length) {
    let best = fb[0];
    for (const e of fb) { if (e.frame <= frame) best = e; else break; }
    if (frame > fb[fb.length-1].frame) best = fb[fb.length-1];
    return {x: best.x, y: best.y, w: best.w, h: best.h};
  }
  const c = center(box, frame);
  return {x: c.x - box.width/2, y: c.y - box.height/2, w: box.width, h: box.height};
}
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

export function AnnotationOverlay({width,height,featureKey,interactive,videoRef,getTimeOffset,fps}: {width:number;height:number;featureKey:string;interactive:boolean;videoRef?:React.RefObject<HTMLVideoElement|null>;getTimeOffset?:()=>number;fps?:number}) {
  const a=useAnnotation(); const [drag,setDrag]=useState<{start:XY;end:XY}|null>(null); const ref=useRef<SVGSVGElement>(null);
  // 播放时视频是逐帧 seek 驱动的,实际显示的帧可能滞后于逻辑帧;
  // 用 requestVideoFrameCallback 拿"屏幕上正在显示"的帧来画框和轮廓,保证所见即所得。
  const [videoFrame,setVideoFrame]=useState<number|null>(null);
  const getTimeOffsetRef=useRef(getTimeOffset); getTimeOffsetRef.current=getTimeOffset;
  useEffect(()=>{
    const v=videoRef?.current as RVFCVideo|null;
    if(!v||!v.requestVideoFrameCallback) return;
    let handle=0;
    const cb=()=>{
      const f=Math.round((v.currentTime-(getTimeOffsetRef.current?.()??0))*(fps??30));
      setVideoFrame(prev=>(prev===f?prev:f));
      handle=v.requestVideoFrameCallback!(cb);
    };
    handle=v.requestVideoFrameCallback(cb);
    return ()=>{v.cancelVideoFrameCallback?.(handle);};
  },[videoRef,fps]);
  if(!a || !a.dataset || a.currentEpisode!==a.episode || a.episode===null) return null;
  const drawFrame=videoFrame??a.frame;
  const seg=a.segments[a.selected];
  const inside=interactive && !!seg && a.frame>=seg.start_frame && a.frame<=seg.end_frame;
  const defaultCam=a.cameras[0];
  // 只画属于本相机的框;老数据没有 camera 字段,视为第一个相机
  const ownBox=(b:Box)=>(b.camera ?? defaultCam)===featureKey;
  const xy=(e:React.PointerEvent<SVGSVGElement>,clamp=true):XY|null => {const svg=ref.current, m=svg?.getScreenCTM(); if(!svg||!m)return null;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());if(!clamp && (p.x<0 || p.y<0 || p.x>width || p.y>height))return null;return {x:Math.max(0,Math.min(width,p.x)),y:Math.max(0,Math.min(height,p.y))};};
  const patchBox=(fn:(b:Box)=>Box)=>{if(!seg||a.selectedBox<0)return;const next=a.segments.map((s,i)=>i===a.selected?{...s,bboxes:s.bboxes.map((b,j)=>j===a.selectedBox?fn(b):b)}:s);a.update(next);};
  const down=(e:React.PointerEvent<SVGSVGElement>)=>{if(!inside)return; const p=xy(e,false); if(!p)return; a.pause(); if(a.sam.mode){void a.samPoint(p.x,p.y,!e.shiftKey);return;} if(a.track){patchBox(b=>({...b,keypoints:[...b.keypoints.filter(k=>k.frame!==a.frame),{frame:a.frame,cx:p.x,cy:p.y}].sort((x,y)=>x.frame-y.frame)}));return;} e.currentTarget.setPointerCapture(e.pointerId);setDrag({start:p,end:p});};
  const up=(e:React.PointerEvent<SVGSVGElement>)=>{if(!drag||!seg)return;const p=xy(e)||drag.end; const x=Math.min(drag.start.x,p.x),y=Math.min(drag.start.y,p.y),w=Math.abs(p.x-drag.start.x),h=Math.abs(p.y-drag.start.y);setDrag(null);if(w<4||h<4)return;const label=a.boxLabel.trim();if(!label)return; const box={id:null,x,y,width:w,height:h,label:label.trim(),keypoints:[],camera:featureKey}; a.update(a.segments.map((s,i)=>i===a.selected?{...s,bboxes:[...s.bboxes,box]}:s));a.selectBox(seg.bboxes.length);};
  const fontSize=Math.max(12,width/50);
  const bannerText=a.sam.mode?(a.sam.busy?'SAM 处理中…':'SAM 点选 · 点击=正点 Shift+点击=负点'):a.track?`标记轨迹中 · 第 ${a.frame} 帧`:`拖动创建目标框 · 第 ${a.frame} 帧`;
  const maskUrl=interactive&&a.sam.objectId!==null&&(a.sam.propagated||a.frame===a.sam.promptFrame)?a.samMaskUrl(drawFrame):null;
  const hasOwnBoxes=a.segments.some(s=>drawFrame>=s.start_frame&&drawFrame<=s.end_frame&&s.bboxes.some(ownBox));
  if(!interactive && !hasOwnBoxes) return null;
  const bannerWidth=bannerText.length*fontSize*0.62+fontSize;
  const bannerHeight=fontSize*1.9;
  return <svg ref={ref} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={down} onPointerMove={e=>{if(drag){const p=xy(e);if(p)setDrag({...drag,end:p});}}} onPointerUp={up} onPointerCancel={()=>setDrag(null)} style={{position:'absolute',inset:0,width:'100%',height:'100%',zIndex:5,cursor:inside?'crosshair':'default',touchAction:'none',pointerEvents:interactive?'auto':'none'}} aria-label="目标框标注画布">
    <rect width={width} height={height} fill="transparent" />
    {a.showMasks && a.segments.flatMap((s,si)=>drawFrame>=s.start_frame&&drawFrame<=s.end_frame?s.bboxes.map((b,bi)=>{
      if(!ownBox(b)||!b.mask_key)return null;
      return <image key={`mk${si}-${bi}`} href={`/api/bridge/mask_file?dataset=${encodeURIComponent(a.dataset)}&episode=${a.episode}&key=${b.mask_key}&frame=${drawFrame}`} x={0} y={0} width={width} height={height} opacity={0.4} pointerEvents="none" filter="url(#samTint)"/>;
    }):[])}
    {a.segments.flatMap((s,si)=>drawFrame>=s.start_frame&&drawFrame<=s.end_frame?s.bboxes.map((b,bi)=>{if(!ownBox(b))return null;const p=frameBox(b,drawFrame);const selected=interactive&&si===a.selected&&bi===a.selectedBox;return <g key={`${si}-${bi}`} className={selected?'text-primary':'text-cyan-400'}><rect x={p.x} y={p.y} width={p.w} height={p.h} fill="none" stroke="currentColor" strokeWidth={3} vectorEffect="non-scaling-stroke"/><text x={p.x} y={Math.max(fontSize,p.y-4)} fill="currentColor" fontSize={fontSize} stroke="#111" strokeWidth={2} paintOrder="stroke">{b.label}</text></g>;}):[])}
    {inside && seg && a.selectedBox >= 0 && seg.bboxes[a.selectedBox] && ownBox(seg.bboxes[a.selectedBox]) && seg.bboxes[a.selectedBox].keypoints.length > 0 && (() => {
      const points = [...seg.bboxes[a.selectedBox].keypoints].sort((x,y)=>x.frame-y.frame);
      const r = Math.max(3,width/120);
      return <g pointerEvents="none" className="text-rose-400"><polyline points={points.map(p=>`${p.cx},${p.cy}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />{points.map(p=><g key={p.frame}><circle cx={p.cx} cy={p.cy} r={p.frame===drawFrame?r*1.35:r} fill={p.frame===drawFrame?'#facc15':'currentColor'} stroke="#111" strokeWidth={1} vectorEffect="non-scaling-stroke"/>{p.frame===drawFrame&&<text x={p.cx+r*1.8} y={p.cy-r*1.2} fontSize={fontSize} fill="currentColor" stroke="#111" strokeWidth={2} paintOrder="stroke">{p.frame}</text>}</g>)}</g>;
    })()}
    {drag && <rect x={Math.min(drag.start.x,drag.end.x)} y={Math.min(drag.start.y,drag.end.y)} width={Math.abs(drag.end.x-drag.start.x)} height={Math.abs(drag.end.y-drag.start.y)} fill="none" stroke="currentColor" className="text-foreground" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"/>}
    <defs><filter id="samTint" x="0%" y="0%" width="100%" height="100%"><feFlood floodColor="#3aa7ff" floodOpacity="1"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>
    {maskUrl && <image key={maskUrl} href={maskUrl} x={0} y={0} width={width} height={height} opacity={0.55} pointerEvents="none" filter="url(#samTint)"/>}
    {interactive && a.sam.bbox && !a.sam.propagated && a.frame===a.sam.promptFrame && <rect x={a.sam.bbox.x} y={a.sam.bbox.y} width={a.sam.bbox.w} height={a.sam.bbox.h} fill="none" stroke="#3aa7ff" strokeWidth={3} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
    {interactive && a.sam.points.filter(p=>p.frame===drawFrame).map((p,i)=>{const r=Math.max(4,width/100);return <circle key={i} cx={p.x} cy={p.y} r={r} fill={p.positive?'#4ade80':'#f87171'} stroke="#111" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none"/>;})}
    {interactive && <g pointerEvents="none" className="text-primary">
      <rect x={8} y={8} width={bannerWidth} height={bannerHeight} rx={5} fill="currentColor" opacity={0.9}/>
      <text x={8+fontSize*0.6} y={8+bannerHeight/2+fontSize*0.35} fontSize={fontSize} fill="var(--primary-foreground, #fff)">{bannerText}</text>
    </g>}
  </svg>;
}
