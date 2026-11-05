import { useEffect, useState } from 'react';
import { Badge, Button, Separator, cn } from '@/ui';
import type { DictKind, Segment } from './AnnotationContext';
import { composeSegmentText, useAnnotation } from './AnnotationContext';
import { StatusBar } from './StatusBar';
import { ProblemMenu } from './ProblemMenu';

const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring';

const DICT_FIELDS: {kind: DictKind; label: string}[] = [
  {kind: 'skill', label: '技能'},
  {kind: 'object', label: '对象'},
  {kind: 'target', label: '目标'},
  {kind: 'adverb', label: '状语'},
];

/** 字典下拉 + 可输入:失焦/回车提交,新词自动补入本地字典并上报后端待确认。 */
function DictInput({kind, label, value, dict, disabled, onCommit}: {kind: DictKind; label: string; value: string; dict: string[]; disabled?: boolean; onCommit: (word: string) => void}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const nv = v.trim();
    if (nv !== value.trim()) onCommit(nv);
  };
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <input
        list={`dict-${kind}`}
        value={v}
        disabled={disabled}
        onChange={e => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="下拉选择或输入新词"
        className={inputClass}
      />
      <datalist id={`dict-${kind}`}>{dict.map(w => <option key={w} value={w} />)}</datalist>
    </label>
  );
}

export function AnnotationPanel() {
  const a = useAnnotation();
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null);
  if (!a) return null;

  const active = a.episode !== null && a.episode === a.currentEpisode;
  const segment: Segment | undefined = active ? a.segments[a.selected] : undefined;
  const inSegment =
    !!segment && a.frame >= segment.start_frame && a.frame <= segment.end_frame;
  const problemActive = !!segment?.problem && !segment.problem.fixed_at;

  const patchSegment = (index: number, value: Segment) => {
    a.update(a.segments.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const setField = (kind: DictKind, word: string) => {
    if (!segment || a.readOnly) return;
    if (word && !a.dict[kind].includes(word)) a.addDictWord(kind, word);
    const next: Segment = {...segment};
    next[kind] = word || undefined;
    const composed = composeSegmentText(next);
    // 老数据没有四项字段:用户没填过任何一项时不动原 text,填过则以拼句为准
    if (composed || segment.skill || segment.object || segment.target || segment.adverb) next.text = composed;
    patchSegment(a.selected, next);
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
          {!a.readOnly && (
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!a.dirty || a.saving}
              onClick={() => void a.save()}
            >
              {a.saving ? '保存中…' : '保存'}
            </Button>
          )}
        </div>
      </div>

      <StatusBar />

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
              <div
                className={cn(
                  'rounded-md border px-2 py-1.5',
                  problemActive ? 'border-red-500/50 bg-red-500/5' : 'border-border bg-muted/40',
                )}
                onContextMenu={e => {
                  e.preventDefault();
                  if (!a.readOnly) setMenu({x: e.clientX, y: e.clientY});
                }}
                title={a.readOnly ? undefined : '右键可标记无效片段'}
              >
                <div className="font-mono text-[11px] text-muted-foreground">
                  #{a.selected} · {segment.start_frame}–{segment.end_frame} 帧
                </div>
                <div className={cn('truncate text-[12px]', problemActive && 'text-red-500 line-through decoration-red-500')}>
                  {segment.text || '未命名片段'}
                </div>
                {problemActive && segment.problem && (
                  <div className="mt-1 flex items-center justify-between gap-1 text-[11px] text-red-500">
                    <span className="min-w-0 truncate">问题:{segment.problem.reason} · {segment.problem.by}</span>
                    {!a.readOnly && (
                      <button
                        type="button"
                        className="shrink-0 rounded border border-red-500/40 px-1 py-0.5 text-[10px] hover:bg-red-500/10"
                        onClick={() => a.fixProblem(a.selected)}
                      >
                        标记已修正
                      </button>
                    )}
                  </div>
                )}
                {segment.problem?.fixed_at && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    原问题「{segment.problem.reason}」已修正
                  </div>
                )}
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
                <span className="text-[11px] font-medium text-muted-foreground">结构化描述（字典下拉，可输入新词）</span>
                {DICT_FIELDS.map(f => (
                  <DictInput
                    key={f.kind}
                    kind={f.kind}
                    label={f.label}
                    value={segment[f.kind] ?? ''}
                    dict={a.dict[f.kind]}
                    disabled={a.readOnly}
                    onCommit={word => setField(f.kind, word)}
                  />
                ))}
              </div>
            </>
          )}

          {segment && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">目标框 / 关键点轨迹</span>
                <input
                  aria-label="目标框名称"
                  list="dict-boxlabel"
                  value={a.boxLabel}
                  disabled={a.readOnly}
                  onChange={(event) => a.setBoxLabel(event.target.value)}
                  onBlur={() => {
                    const w = a.boxLabel.trim();
                    if (w && !a.dict.object.includes(w)) a.addDictWord('object', w);
                  }}
                  placeholder="目标框名称"
                  className={inputClass}
                />
                <datalist id="dict-boxlabel">{a.dict.object.map(w => <option key={w} value={w} />)}</datalist>
                {!a.readOnly && !inSegment && (
                  <p className="m-0 text-amber-600">播放头不在该片段范围内，先跳回片段内再绘制。</p>
                )}
                {!a.readOnly && (
                  <p className="m-0 text-[11px] text-muted-foreground">
                    {a.track
                      ? `标记轨迹中 · 第 ${a.frame} 帧：点击画面设置目标中心。`
                      : '目标框优先用 SAM 生成；SAM 不可用时才在画面拖动补画。'}
                  </p>
                )}

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
                        {a.cameras.length > 1 && (
                          <span className="text-muted-foreground">
                            [{(box.camera ?? a.cameras[0] ?? '').replace('observation.images.', '')}]{' '}
                          </span>
                        )}
                        {box.label} · {Math.round(box.width)}×{Math.round(box.height)} ·{' '}
                        {box.keypoints.length} 个关键点
                      </span>
                    </Button>
                    {!a.readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        aria-label="删除目标框"
                        onClick={() => removeBox(index)}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                ))}

                <Button
                  variant={a.showMasks ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => a.setShowMasks(!a.showMasks)}
                >
                  {a.showMasks ? '分割轮廓预览: 开' : '分割轮廓预览: 关'}
                </Button>

                {!a.readOnly && a.selectedBox >= 0 && (
                  <div className="flex gap-1">                    <Button
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
          {segment && !a.readOnly && (
            <>
              <Separator />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">SAM 智能分割跟踪</span>
                <Button
                  variant={a.sam.mode ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={a.sam.busy && !a.sam.mode}
                  onClick={() => a.setSamMode(!a.sam.mode)}
                >
                  {a.sam.mode ? '退出 SAM 模式' : 'SAM 点选分割'}
                </Button>
                {a.sam.mode && (
                  <>
                    {a.cameras.length > 1 && (
                      <select
                        aria-label="SAM 相机"
                        value={a.sam.camera ?? a.cameras[0]}
                        disabled={a.sam.busy}
                        onChange={(event) => a.setSamCamera(event.target.value)}
                        className={inputClass}
                      >
                        {a.cameras.map((cam) => (
                          <option key={cam} value={cam}>{cam.replace('observation.images.', '')}</option>
                        ))}
                      </select>
                    )}
                    {a.sam.status && (
                      <p className="m-0 text-[11px] text-muted-foreground">{a.sam.status}</p>
                    )}
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="h-7 flex-1 px-2 text-[11px]"
                        disabled={a.sam.busy || a.sam.objectId === null}
                        onClick={() => void a.samPropagate()}
                      >
                        {a.sam.progress ? `${a.sam.progress.done}/${a.sam.progress.total}` : '传播跟踪'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-1 px-2 text-[11px]"
                        disabled={a.sam.busy || a.sam.objectId === null}
                        onClick={() => void a.samDiscard()}
                      >
                        放弃对象
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          {a.readOnly && (
            <p className="m-0 text-[11px] text-muted-foreground">审核模式为只读，请使用上方「通过 / 打回」。</p>
          )}
          <p className="m-0 text-[11px] text-muted-foreground">
            当前帧 {a.frame} · Q 起点 · R 终点 · Enter 新建片段 · Ctrl/⌘+S 保存 · Esc 退出轨迹
          </p>
        </>
      )}
      <ProblemMenu anchor={menu} onClose={() => setMenu(null)} onPick={reason => a.markProblem(a.selected, reason)} />
    </aside>
  );
}
