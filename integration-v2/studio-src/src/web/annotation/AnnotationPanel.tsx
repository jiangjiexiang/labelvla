import { Badge, Button, Separator } from '@/ui';
import type { Segment } from './AnnotationContext';
import { useAnnotation } from './AnnotationContext';

const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function AnnotationPanel() {
  const a = useAnnotation();
  if (!a) return null;

  const active = a.episode !== null && a.episode === a.currentEpisode;
  const segment: Segment | undefined = active ? a.segments[a.selected] : undefined;
  const inSegment =
    !!segment && a.frame >= segment.start_frame && a.frame <= segment.end_frame;

  const patchSegment = (index: number, value: Segment) => {
    a.update(a.segments.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const removeBox = (index: number) => {
    if (!segment) return;
    patchSegment(a.selected, {
      ...segment,
      bboxes: segment.bboxes.filter((_, boxIndex) => boxIndex !== index),
    });
    a.selectBox(-1);
    a.setTrack(false);
  };

  return (
    <aside className="unified-annotation flex w-[260px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-background p-3 text-xs text-foreground max-[900px]:w-full max-[900px]:max-h-[340px] max-[900px]:border-l-0 max-[900px]:border-t">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <strong className="truncate text-sm">LabelVLA 标注</strong>
          <span className="text-[11px] text-muted-foreground">Episode {a.episode ?? '—'}</span>
        </div>
        <div className="flex items-center gap-1">
          {a.dirty && (
            <Badge variant="secondary" className="border-amber-500/50 text-amber-600">
              已修改
            </Badge>
          )}
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!a.dirty || a.saving}
            onClick={() => void a.save()}
          >
            {a.saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      {a.error && (
        <p role="status" className="m-0 text-amber-600">
          {a.error}
        </p>
      )}

      {!a.dataset && (
        <p className="m-0 text-muted-foreground">正在连接服务器数据集…</p>
      )}

      {a.dataset && !active && (
        <p className="m-0 text-amber-600">正在加载当前片段标注…</p>
      )}

      {active && (
        <>
          <Separator />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">当前 Subtask 片段</span>
            {segment ? (
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <div className="font-mono text-[11px] text-muted-foreground">
                  #{a.selected} · {segment.start_frame}–{segment.end_frame} 帧
                </div>
                <div className="truncate text-[12px]">{segment.text || '未命名片段'}</div>
              </div>
            ) : (
              <p className="m-0 text-amber-600">
                当前帧不在任何片段内，请在下方 Subtask 轨道选择或创建片段。
              </p>
            )}
            <p className="m-0 text-[11px] text-muted-foreground">
              分段请在播放条 Subtask 轨道编辑（需先在左侧 Episode 侧栏开启编辑模式）。
            </p>
          </div>

          {segment && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">目标框 / 手动轨迹</span>
                <input
                  aria-label="目标框名称"
                  value={a.boxLabel}
                  onChange={(event) => a.setBoxLabel(event.target.value)}
                  placeholder="目标框名称"
                  className={inputClass}
                />
                {!inSegment && (
                  <p className="m-0 text-amber-600">播放头不在该片段范围内，先跳回片段内再绘制。</p>
                )}
                <p className="m-0 text-[11px] text-muted-foreground">
                  {a.track
                    ? `标记轨迹中 · 第 ${a.frame} 帧：点击画面设置目标中心。`
                    : '在第一个相机画面拖动以创建目标框。'}
                </p>

                {segment.bboxes.length === 0 && (
                  <p className="m-0 text-[11px] text-muted-foreground">该片段还没有目标框。</p>
                )}

                {segment.bboxes.map((box, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <Button
                      variant={a.selectedBox === index ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 min-w-0 flex-1 justify-start px-2 text-[11px] font-normal"
                      onClick={() => {
                        a.selectBox(index);
                        a.setTrack(false);
                      }}
                    >
                      <span className="truncate">
                        {box.label} · {Math.round(box.width)}×{Math.round(box.height)} ·{' '}
                        {box.keypoints.length} 个关键点
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      aria-label="删除目标框"
                      onClick={() => removeBox(index)}
                    >
                      ×
                    </Button>
                  </div>
                ))}

                {a.selectedBox >= 0 && (
                  <div className="flex gap-1">
                    <Button
                      variant={a.track ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 flex-1 px-2 text-[11px]"
                      onClick={() => a.setTrack(!a.track)}
                    >
                      {a.track ? '结束轨迹' : '标记轨迹'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 flex-1 px-2 text-[11px]"
                      onClick={() => {
                        if (!segment) return;
                        patchSegment(a.selected, {
                          ...segment,
                          bboxes: segment.bboxes.map((box, boxIndex) =>
                            boxIndex === a.selectedBox ? { ...box, keypoints: [] } : box,
                          ),
                        });
                      }}
                    >
                      清除轨迹
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
          <p className="m-0 text-[11px] text-muted-foreground">
            当前帧 {a.frame} · Ctrl/⌘+S 保存 · Esc 退出轨迹
          </p>
        </>
      )}
    </aside>
  );
}
