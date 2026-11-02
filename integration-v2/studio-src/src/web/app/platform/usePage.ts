/** 平台页状态:页面选择不写入地址栏,地址始终保持站点根路径。 */
import { useCallback, useSyncExternalStore } from 'react';

export type PlatformPage = 'dashboard' | 'datasets' | 'episodes' | 'tasks' | 'task-create' | 'task-detail' | 'videos' | 'versions' | 'users' | 'qc' | null;

const STORAGE_KEY = 'labelvla.platform-page';
const PAGES = ['dashboard', 'datasets', 'episodes', 'tasks', 'task-create', 'task-detail', 'videos', 'versions', 'users', 'qc'] as const;

function parsePage(value: string | null): PlatformPage {
  return PAGES.includes(value as typeof PAGES[number]) ? value as Exclude<PlatformPage, null> : null;
}

function stripPageParam() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('page')) return;
  params.delete('page');
  const url = `${window.location.pathname}${params.size ? `?${params}` : ''}`;
  window.history.replaceState(null, '', url);
}

function readInitialPage(): PlatformPage {
  if (typeof window === 'undefined') return 'dashboard';
  const fromUrl = parsePage(new URLSearchParams(window.location.search).get('page'));
  stripPageParam();
  if (fromUrl) {
    try { window.sessionStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* 忽略存储限制 */ }
    return fromUrl;
  }
  try { return parsePage(window.sessionStorage.getItem(STORAGE_KEY)) ?? 'dashboard'; } catch { return 'dashboard'; }
}

let currentPage = readInitialPage();
let studioReturnPage: PlatformPage = currentPage || 'tasks';
export function getStudioReturnPage(): PlatformPage { return studioReturnPage; }
if (typeof window !== 'undefined') {
  window.history.replaceState({ ...window.history.state, labelvlaPage: currentPage }, '', window.location.href);
  window.addEventListener('popstate', (event: PopStateEvent) => {
    const value = event.state?.labelvlaPage;
    if (value !== null && !PAGES.includes(value)) return;
    currentPage = value;
    if (value) studioReturnPage = value;
    try {
      if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore unavailable storage */ }
    for (const listener of listeners) listener();
  });
}
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const getSnapshot = () => currentPage;

export function usePage(): [PlatformPage, (p: PlatformPage) => void] {
  const page = useSyncExternalStore(subscribe, getSnapshot);
  const setPage = useCallback((p: PlatformPage) => {
    if (p === currentPage) return;
    if (p === null && currentPage) studioReturnPage = currentPage;
    window.history.pushState({ ...window.history.state, labelvlaPage: p }, '', window.location.href);
    currentPage = p;
    try {
      if (p) window.sessionStorage.setItem(STORAGE_KEY, p);
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* 忽略存储限制 */ }
    stripPageParam();
    for (const listener of listeners) listener();
  }, []);
  return [page, setPage];
}

/** 页面之间传递的上下文(当前任务 / 数据集 / episode)。 */
export interface PlatformSelection {
  taskId?: number;
  dataset?: string;
  episode?: number;
}

let currentSelection: PlatformSelection = {};
const selectionListeners = new Set<() => void>();
const getSelectionSnapshot = () => currentSelection;

function subscribeSelection(cb: () => void) {
  selectionListeners.add(cb);
  return () => { selectionListeners.delete(cb); };
}

export function useSelection(): [PlatformSelection, (s: PlatformSelection) => void] {
  const selection = useSyncExternalStore(subscribeSelection, getSelectionSnapshot);
  const setSelection = useCallback((s: PlatformSelection) => {
    currentSelection = s;
    for (const listener of selectionListeners) listener();
  }, []);
  return [selection, setSelection];
}