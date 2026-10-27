import { useRef, useState } from 'react';
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
export function AnnotationOverlay({width,height}: {width:number;height:number}) {
  const a=useAnnotation(); const [drag,setDrag]=useState<{start:XY;end:XY}|null>(null); const ref=useRef<SVGSVGElement>(null);
  if(!a || !a.dataset || a.currentEpisode!==a.episode || a.episode===null) return null;
  const seg=a.segments[a.selected];
  const inside=!!seg && a.frame>=seg.start_frame && a.frame<=seg.end_frame;
  const xy=(e:React.PointerEvent<SVGSVGElement>,clamp=true):XY|null => {const svg=ref.current, m=svg?.getScreenCTM(); if(!svg||!m)return null;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());if(!clamp && (p.x<0 || p.y<0 || p.x>width || p.y>height))return null;return {x:Math.max(0,Math.min(width,p.x)),y:Math.max(0,Math.min(height,p.y))};};
  const patchBox=(fn:(b:Box)=>Box)=>{if(!seg||a.selectedBox<0)return;const next=a.segments.map((s,i)=>i===a.selected?{...s,bboxes:s.bboxes.map((b,j)=>j===a.selectedBox?fn(b):b)}:s);a.update(next);};
  const down=(e:React.PointerEvent<SVGSVGElement>)=>{if(!inside)return; const p=xy(e,false); if(!p)return; a.pause(); if(a.track){patchBox(b=>({...b,keypoints:[...b.keypoints.filter(k=>k.frame!==a.frame),{frame:a.frame,cx:p.x,cy:p.y}].sort((x,y)=>x.frame-y.frame)}));return;} e.currentTarget.setPointerCapture(e.pointerId);setDrag({start:p,end:p});};
  const up=(e:React.PointerEvent<SVGSVGElement>)=>{if(!drag||!seg)return;const p=xy(e)||drag.end; const x=Math.min(drag.start.x,p.x),y=Math.min(drag.start.y,p.y),w=Math.abs(p.x-drag.start.x),h=Math.abs(p.y-drag.start.y);setDrag(null);if(w<4||h<4)return;const label=a.boxLabel.trim();if(!label)return; const box={id:null,x,y,width:w,height:h,label:label.trim(),keypoints:[]}; a.update(a.segments.map((s,i)=>i===a.selected?{...s,bboxes:[...s.bboxes,box]}:s));a.selectBox(seg.bboxes.length);};
  const fontSize=Math.max(12,width/50);
  const bannerText=a.track?`标记轨迹中 · 第 ${a.frame} 帧`:`拖动创建目标框 · 第 ${a.frame} 帧`;
  const bannerWidth=bannerText.length*fontSize*0.62+fontSize;
  const bannerHeight=fontSize*1.9;
  return <svg ref={ref} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={down} onPointerMove={e=>{if(drag){const p=xy(e);if(p)setDrag({...drag,end:p});}}} onPointerUp={up} onPointerCancel={()=>setDrag(null)} style={{position:'absolute',inset:0,width:'100%',height:'100%',zIndex:5,cursor:inside?'crosshair':'default',touchAction:'none'}} aria-label="目标框标注画布">
    <rect width={width} height={height} fill="transparent" />
    {a.segments.flatMap((s,si)=>a.frame>=s.start_frame&&a.frame<=s.end_frame?s.bboxes.map((b,bi)=>{const p=center(b,a.frame);const selected=si===a.selected&&bi===a.selectedBox;return <g key={`${si}-${bi}`} className={selected?'text-primary':'text-cyan-400'}><rect x={p.x-b.width/2} y={p.y-b.height/2} width={b.width} height={b.height} fill="none" stroke="currentColor" strokeWidth={3} vectorEffect="non-scaling-stroke"/><text x={p.x-b.width/2} y={Math.max(fontSize,p.y-b.height/2-4)} fill="currentColor" fontSize={fontSize} stroke="#111" strokeWidth={2} paintOrder="stroke">{b.label}</text></g>;}):[])}
    {inside && seg && a.selectedBox >= 0 && seg.bboxes[a.selectedBox]?.keypoints.length > 0 && (() => {
      const points = [...seg.bboxes[a.selectedBox].keypoints].sort((x,y)=>x.frame-y.frame);
      const r = Math.max(3,width/120);
      return <g pointerEvents="none" className="text-rose-400"><polyline points={points.map(p=>`${p.cx},${p.cy}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />{points.map(p=><g key={p.frame}><circle cx={p.cx} cy={p.cy} r={p.frame===a.frame?r*1.35:r} fill={p.frame===a.frame?'#facc15':'currentColor'} stroke="#111" strokeWidth={1} vectorEffect="non-scaling-stroke"/>{p.frame===a.frame&&<text x={p.cx+r*1.8} y={p.cy-r*1.2} fontSize={fontSize} fill="currentColor" stroke="#111" strokeWidth={2} paintOrder="stroke">{p.frame}</text>}</g>)}</g>;
    })()}
    {drag && <rect x={Math.min(drag.start.x,drag.end.x)} y={Math.min(drag.start.y,drag.end.y)} width={Math.abs(drag.end.x-drag.start.x)} height={Math.abs(drag.end.y-drag.start.y)} fill="none" stroke="currentColor" className="text-foreground" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"/>}
    <g pointerEvents="none" className="text-primary">
      <rect x={8} y={8} width={bannerWidth} height={bannerHeight} rx={5} fill="currentColor" opacity={0.9}/>
      <text x={8+fontSize*0.6} y={8+bannerHeight/2+fontSize*0.35} fontSize={fontSize} fill="var(--primary-foreground, #fff)">{bannerText}</text>
    </g>
  </svg>;
}
