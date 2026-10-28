import { useEffect, useRef } from 'react';
import type { Segment } from './AnnotationContext';
import { useAnnotation } from './AnnotationContext';
import {
  useLeRobotSelection,
  useLeRobotSubtask,
} from '../../react/contexts/LeRobotContext';

const EMPTY_LABEL = '_';

function labelFor(text: string): string {
  return text.trim() === '' ? EMPTY_LABEL : text.trim();
}

function signature(segments: readonly { startFrame: number; endFrame: number; label: string }[]) {
  return segments.map((s) => `${s.startFrame}:${s.endFrame}:${s.label}`).join('|');
}

function pickBoxes(native: { startFrame: number; endFrame: number }, source: Segment[], index: number) {
  const exact = source.find(
    (s) => s.start_frame === native.startFrame && s.end_frame === native.endFrame,
  );
  const candidate =
    exact ??
    (source[index] &&
    source[index].start_frame <= native.endFrame &&
    source[index].end_frame >= native.startFrame
      ? source[index]
      : undefined);
  if (!candidate) return [];
  return candidate.bboxes.map((box) => ({
    ...box,
    keypoints: box.keypoints.filter(
      (point) => point.frame >= native.startFrame && point.frame <= native.endFrame,
    ),
  }));
}

/**
 * Bridges the LabelVLA sidecar segments with the native LeRobot Studio subtask overlay.
 * - sidecar -> native: seeded on episode load / after saving.
 * - native -> sidecar: user edits (drag, rename, delete, gap fill) are merged back,
 *   preserving bounding boxes by frame range.
 */
export function SubtaskBridge() {
  const annotation = useAnnotation();
  const { selectedEpisodeIndex } = useLeRobotSelection();
  const { canAnnotate, currentSegments, episodeLength, replaceEpisodeSegments } =
    useLeRobotSubtask();

  const suppressPushRef = useRef<string | null>(null);
  const nativeReadyRef = useRef(false);
  const episodeRef = useRef<number | null>(null);

  const active =
    !!annotation &&
    annotation.episode !== null &&
    annotation.episode === selectedEpisodeIndex;
  const sidecar = active && annotation ? annotation.segments : [];
  const sidecarSig = signature(
    sidecar.map((s) => ({
      startFrame: s.start_frame,
      endFrame: s.end_frame,
      label: labelFor(s.text),
    })),
  );
  const nativeSig = signature(currentSegments);

  useEffect(() => {
    if (episodeRef.current === selectedEpisodeIndex) return;
    episodeRef.current = selectedEpisodeIndex;
    suppressPushRef.current = null;
    nativeReadyRef.current = false;
  }, [selectedEpisodeIndex]);

  // native -> sidecar (declared before push so a user edit is not overwritten)
  useEffect(() => {
    if (!annotation || !active || !canAnnotate || annotation.saving) return;
    if (!nativeReadyRef.current) return;
    if (nativeSig === sidecarSig) return;
    if (nativeSig === suppressPushRef.current) {
      suppressPushRef.current = null;
      return;
    }
    const merged: Segment[] = currentSegments.map((segment, index) => ({
      start_frame: segment.startFrame,
      end_frame: segment.endFrame,
      text: segment.label === EMPTY_LABEL ? '' : segment.label,
      bboxes: pickBoxes(segment, sidecar, index),
    }));
    suppressPushRef.current = nativeSig;
    annotation.update(merged);
  }, [annotation, active, canAnnotate, currentSegments, nativeSig, sidecar, sidecarSig]);

  // sidecar -> native
  useEffect(() => {
    if (!annotation || !active || !annotation.dataset || annotation.saving || !canAnnotate) return;
    if (episodeLength <= 0) return;
    if (nativeSig === sidecarSig) {
      nativeReadyRef.current = true;
      return;
    }
    if (nativeSig === suppressPushRef.current) {
      suppressPushRef.current = null;
      return;
    }
    const mapped = sidecar.map((s) => ({
      startFrame: s.start_frame,
      endFrame: s.end_frame,
      label: labelFor(s.text),
    }));
    try {
      replaceEpisodeSegments(mapped);
      nativeReadyRef.current = true;
    } catch (error) {
      console.warn('同步分段到原生轨道失败', error);
    }
  }, [
    annotation,
    active,
    canAnnotate,
    episodeLength,
    nativeSig,
    sidecar,
    sidecarSig,
    replaceEpisodeSegments,
  ]);

  return null;
}
