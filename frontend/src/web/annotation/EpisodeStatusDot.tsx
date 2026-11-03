import { useAnnotation, type EpisodeStatus } from './AnnotationContext';

export const STATUS_COLORS: Record<EpisodeStatus, string> = {
  untagged: '#9ca3af',
  labeling: '#3b82f6',
  review: '#eab308',
  approved: '#22c55e',
  rejected: '#ef4444',
};
export const STATUS_LABELS: Record<EpisodeStatus, string> = {
  untagged: '未标',
  labeling: '标注中',
  review: '待审核',
  approved: '已通过',
  rejected: '已打回',
};

/** episode 侧栏状态点(灰=未标 蓝=标中 黄=待审 绿=已过 红=打回);无看板数据时不渲染。 */
export function EpisodeStatusDot({episode}: {episode: number}) {
  const a = useAnnotation();
  const st = a?.statusBoard[episode];
  if (!st) return null;
  return (
    <span
      title={`状态:${STATUS_LABELS[st]}`}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{backgroundColor: STATUS_COLORS[st]}}
    />
  );
}
