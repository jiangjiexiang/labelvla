/** 平台页状态:页面选择不写入地址栏,地址始终保持站点根路径。 */
import { useCallback, useSyncExternalStore } from 'react';

export type PlatformPage = 'dashboard' | 'datasets' | 'users' | 'qc' | null;

const STORAGE_KEY = 'labelvla.platform-page';

function parsePage(value: string | null): PlatformPage {
  return value === 'dashboard' || value === 'datasets' || value === 'users' || value === 'qc'
    ? value
    : null;
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
  if (typeof window === 'undefined') return 'datasets';
  const fromUrl = parsePage(new URLSearchParams(window.location.search).get('page'));
  stripPageParam();
  if (fromUrl) {
    try { window.sessionStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* 忽略存储限制 */ }
    return fromUrl;
  }
  try { return parsePage(window.sessionStorage.getItem(STORAGE_KEY)) ?? 'datasets'; } catch { return 'datasets'; }
}

let currentPage = readInitialPage();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const getSnapshot = () => currentPage;

export function usePage(): [PlatformPage, (p: PlatformPage) => void] {
  const page = useSyncExternalStore(subscribe, getSnapshot);
  const setPage = useCallback((p: PlatformPage) => {
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