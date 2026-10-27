import { useEffect, useState } from 'react';
import { useLeRobotData } from '../../react/contexts/LeRobotContext';
import { useAnnotation } from '../annotation/AnnotationContext';
import { connectServerDataset } from './serverDataset';

type DirectoryEntry = { name: string; path: string; is_dataset: boolean };
type DirectoryListing = { path: string; parent: string | null; is_dataset: boolean; entries: DirectoryEntry[] };

export function ServerBridge({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (name: string) => void }) {
  const { initialize } = useLeRobotData();
  const a = useAnnotation();
  const [directory, setDirectory] = useState('/data');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const reset = (e: Event) => { if (a?.dirty) { e.preventDefault(); setMessage('请先保存标注再切换数据集'); } else a?.setDataset(''); };
    window.addEventListener('studio-external-source', reset);
    return () => window.removeEventListener('studio-external-source', reset);
  }, [a]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setListing(null); setMessage('正在读取目录…');
    fetch(`/api/fs?path=${encodeURIComponent(directory)}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).detail || '无法读取目录'); return r.json() as Promise<DirectoryListing>; })
      .then(data => { if (!cancelled) { setListing(data); setMessage(''); } })
      .catch(e => { if (!cancelled) setMessage(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [open, directory]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, busy, onClose]);

  const openDataset = async (path: string) => {
    if (a?.dirty) { setMessage('请先保存当前标注，再切换数据集。'); return; }
    setBusy(true); setMessage('正在读取数据集…');
    try {
      const { name } = await connectServerDataset(path, initialize, a?.setDataset);
      onOpened(name);
      onClose();
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  const button: React.CSSProperties = { border: '1px solid #515158', borderRadius: 5, padding: '6px 10px', color: '#eee', background: '#26262a' };
  return <div role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }} style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,.7)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
    <div role="dialog" aria-modal="true" aria-labelledby="server-picker-title" style={{width:'min(620px,100%)',maxHeight:'min(80vh,700px)',display:'flex',flexDirection:'column',background:'#151518',border:'1px solid #45454a',borderRadius:8,color:'#eee',boxShadow:'0 20px 60px #0009'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderBottom:'1px solid #333'}}><strong id="server-picker-title">选择服务器数据集</strong><button onClick={onClose} disabled={busy} aria-label="关闭" style={{...button,padding:'3px 8px'}}>×</button></div>
      <div style={{display:'flex',gap:8,alignItems:'center',padding:'10px 16px',borderBottom:'1px solid #333'}}><button style={button} disabled={!listing?.parent || busy} onClick={() => listing?.parent && setDirectory(listing.parent)}>上一级</button><span style={{overflowWrap:'anywhere',color:'#b8b8bd',fontSize:13}}>{listing?.path || directory}</span></div>
      <div style={{overflowY:'auto',minHeight:120,padding:'8px 12px',flex:'1 1 auto'}}>
        {listing?.entries.length === 0 && <p style={{color:'#999',padding:8}}>此目录下没有文件夹</p>}
        {listing?.entries.map(entry => <div key={entry.path} style={{display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #303034',padding:'7px 4px'}}>
          <button disabled={busy} onClick={() => setDirectory(entry.path)} style={{textAlign:'left',flex:1,minWidth:0,padding:'5px',overflowWrap:'anywhere'}}>📁 {entry.name}{entry.is_dataset && <span style={{fontSize:11,color:'#95c7a8',marginLeft:8}}>数据集</span>}</button>
          {entry.is_dataset && <button style={button} disabled={busy} onClick={() => void openDataset(entry.path)}>打开</button>}
        </div>)}
      </div>
      {message && <div role="status" style={{padding:'8px 16px',color:'#f0bd74',fontSize:13}}>{message}</div>}
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,padding:'10px 16px',borderTop:'1px solid #333'}}><button style={button} disabled={busy} onClick={onClose}>取消</button>{listing?.is_dataset && <button style={button} disabled={busy} onClick={() => void openDataset(listing.path)}>打开当前数据集</button>}</div>
    </div>
  </div>;
}
