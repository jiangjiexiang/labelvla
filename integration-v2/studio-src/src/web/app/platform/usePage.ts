/** 平台页路由:URL query 里的 page 参数(?page=dashboard|datasets|users|qc)。 */
import { useCallback, useSyncExternalStore } from 'react';

export type PlatformPage = 'dashboard' | 'datasets' | 'users' | 'qc' | null;

function readPage(): PlatformPage {
  const v = new URLSearchParams(window.location.search).get('page');
  return v === 'dashboard' || v === 'datasets' || v === 'users' || v === 'qc' ? v : null;
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener('studio:navigate', cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener('studio:navigate', cb);
  };
}

export function usePage(): [PlatformPage, (p: PlatformPage) => void] {
  const page = useSyncExternalStore(subscribe, readPage);
  const setPage = useCallback((p: PlatformPage) => {
    const params = new URLSearchParams(window.location.search);
    if (p) params.set('page', p);
    else params.delete('page');
    const url = `${window.location.pathname}${params.size ? `?${params}` : ''}`;
    window.history.pushState(null, '', url);
    window.dispatchEvent(new Event('studio:navigate'));
  }, []);
  return [page, setPage];
}
