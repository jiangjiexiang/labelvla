import React, { useCallback, useEffect, useRef, useState } from 'react';

export type ResizableSidebarOrientation = 'horizontal' | 'vertical';

interface ResizableSidebarProps {
  children: React.ReactNode;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  onWidthChange?: (width: number) => void;
  className?: string;
  /**
   * `horizontal`: the sidebar sits left of the content and its width is dragged
   * from the right edge. `vertical`: the sidebar sits under the content (narrow
   * containers) and its height is dragged from the top edge.
   */
  orientation?: ResizableSidebarOrientation;
  /** Accessible name of the drag handle. */
  handleLabel?: string;
}

/** Smallest content area kept beside or above the sidebar while dragging (px). */
const MIN_MAIN_CONTENT_PX = 320;
const MIN_STACKED_MAIN_PX = 200;
const MIN_STACKED_HEIGHT_PX = 120;
/** Initial stacked share of the container height, before the user drags. */
const STACKED_DEFAULT_SHARE = 0.38;
const KEYBOARD_STEP_PX = 16;

export const ResizableSidebar: React.FC<ResizableSidebarProps> = ({
  children,
  minWidth = 200,
  maxWidth = 600,
  defaultWidth = 256,
  onWidthChange,
  className = '',
  orientation = 'horizontal',
  handleLabel,
}) => {
  const vertical = orientation === 'vertical';
  const [width, setWidth] = useState(defaultWidth);
  /** Stacked height in px once the user has dragged; null keeps the default share. */
  const [height, setHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: number; startSize: number } | null>(null);
  const onWidthChangeRef = useRef(onWidthChange);

  useEffect(() => {
    onWidthChangeRef.current = onWidthChange;
  }, [onWidthChange]);

  /** Bounds come from the container the sidebar lives in, not the window. */
  const containerSize = useCallback(() => {
    const parent = sidebarRef.current?.parentElement;
    const rect = parent?.getBoundingClientRect();
    return {
      width: rect?.width || window.innerWidth,
      height: rect?.height || window.innerHeight,
    };
  }, []);

  const clampWidth = useCallback(
    (value: number) => {
      const limit = Math.max(minWidth, containerSize().width - MIN_MAIN_CONTENT_PX);
      return Math.max(minWidth, Math.min(Math.min(maxWidth, limit), value));
    },
    [containerSize, maxWidth, minWidth],
  );

  const clampHeight = useCallback(
    (value: number) => {
      const limit = Math.max(MIN_STACKED_HEIGHT_PX, containerSize().height - MIN_STACKED_MAIN_PX);
      return Math.max(MIN_STACKED_HEIGHT_PX, Math.min(limit, value));
    },
    [containerSize],
  );

  const applySize = useCallback(
    (next: number) => {
      if (vertical) {
        setHeight(clampHeight(next));
        return;
      }
      const clamped = clampWidth(next);
      setWidth(clamped);
      onWidthChangeRef.current?.(clamped);
    },
    [clampHeight, clampWidth, vertical],
  );

  const currentSize = useCallback(() => {
    const rect = sidebarRef.current?.getBoundingClientRect();
    if (vertical) return rect?.height ?? height ?? 0;
    return rect?.width ?? width;
  }, [height, vertical, width]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragRef.current = { start: vertical ? e.clientY : e.clientX, startSize: currentSize() };
      setIsResizing(true);
      document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [currentSize, vertical],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Vertical: the handle is above the sidebar, so dragging up grows it.
      const delta = vertical ? drag.start - e.clientY : e.clientX - drag.start;
      applySize(drag.startSize + delta);
    },
    [applySize, vertical],
  );

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => endDrag, [endDrag]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const grow = vertical ? 'ArrowUp' : 'ArrowRight';
      const shrink = vertical ? 'ArrowDown' : 'ArrowLeft';
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      e.stopPropagation();
      applySize(currentSize() + (e.key === grow ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX));
    },
    [applySize, currentSize, vertical],
  );

  // Track the container box so a narrow host caps the rendered width without
  // overwriting the width the user chose (it comes back when the host widens),
  // and so the separator can report its range to assistive technology.
  const [containerBox, setContainerBox] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const parent = sidebarRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width) setContainerBox({ width: rect.width, height: rect.height });
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const renderedWidth =
    containerBox == null
      ? width
      : Math.max(minWidth, Math.min(width, containerBox.width - MIN_MAIN_CONTENT_PX));

  // ARIA window-splitter values, in px of the sidebar's resizable dimension.
  const ariaRange = vertical
    ? {
        min: MIN_STACKED_HEIGHT_PX,
        max: Math.max(MIN_STACKED_HEIGHT_PX, (containerBox?.height ?? 0) - MIN_STACKED_MAIN_PX),
        now: height ?? Math.round(STACKED_DEFAULT_SHARE * (containerBox?.height ?? 0)),
      }
    : {
        min: minWidth,
        max:
          containerBox == null
            ? maxWidth
            : Math.max(minWidth, Math.min(maxWidth, containerBox.width - MIN_MAIN_CONTENT_PX)),
        now: renderedWidth,
      };
  const ariaNow = Math.round(Math.min(ariaRange.max, Math.max(ariaRange.min, ariaRange.now)));

  const sidebarStyle: React.CSSProperties = vertical
    ? {
        width: '100%',
        flex: height == null ? `0 0 ${STACKED_DEFAULT_SHARE * 100}%` : `0 0 ${height}px`,
        minHeight: MIN_STACKED_HEIGHT_PX,
      }
    : {
        width: `${renderedWidth}px`,
        minWidth: `${minWidth}px`,
        maxWidth: `${maxWidth}px`,
        transition: isResizing ? 'none' : 'width 0.2s ease-out',
      };

  const sidebar = (
    <div
      key="sidebar"
      ref={sidebarRef}
      data-testid="lerobot-resizable-sidebar"
      data-orientation={orientation}
      className={`flex min-h-0 min-w-0 shrink-0 flex-col overflow-x-hidden bg-background ${
        vertical ? 'border-t' : 'h-full border-r'
      } ${className}`}
      style={sidebarStyle}
    >
      {children}
    </div>
  );

  const splitter = (
    <div
      key="splitter"
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={handleLabel}
      aria-valuemin={Math.round(ariaRange.min)}
      aria-valuemax={Math.round(ariaRange.max)}
      aria-valuenow={ariaNow}
      className={`relative z-10 flex shrink-0 touch-none items-center justify-center bg-border transition-colors duration-200 hover:bg-primary/30 focus-visible:bg-primary/60 focus-visible:outline-none ${
        vertical ? 'h-1 w-full cursor-row-resize' : 'w-1 cursor-col-resize'
      } ${isResizing ? 'bg-primary/60' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <div
        className={vertical ? 'absolute inset-x-0 -top-1.5 h-4' : 'absolute inset-y-0 left-0 w-4'}
      />
    </div>
  );

  // The handle sits between content and sidebar in both layouts. Keyed, so React
  // moves (not remounts) the sidebar when the orientation flips.
  return <>{vertical ? [splitter, sidebar] : [sidebar, splitter]}</>;
};
