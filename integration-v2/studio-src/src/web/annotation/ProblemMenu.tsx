import { useEffect } from 'react';

export const PROBLEM_REASONS = ['无效采集数据', '基础数据有误', 'EE 结果异常', '姿态异常数据', '语义描述有误'];

/** 片段右键菜单:标记无效(5 种类型),落盘为 segment.problem 扩展字段。 */
export function ProblemMenu({anchor, onPick, onClose}: {anchor: {x: number; y: number} | null; onPick: (reason: string) => void; onClose: () => void}) {
  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onClose);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onClose);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [anchor, onClose]);
  if (!anchor) return null;
  const style = {left: Math.min(anchor.x, window.innerWidth - 190), top: Math.min(anchor.y, window.innerHeight - 240)};
  return (
    <div
      className="fixed z-[120] w-44 rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md"
      style={style}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="px-2 py-1 text-[11px] text-muted-foreground">标记为无效片段</div>
      {PROBLEM_REASONS.map(reason => (
        <button
          key={reason}
          type="button"
          className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
          onClick={() => { onPick(reason); onClose(); }}
        >
          {reason}
        </button>
      ))}
    </div>
  );
}
