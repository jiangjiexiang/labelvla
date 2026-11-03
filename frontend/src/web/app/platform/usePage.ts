/** 平台页状态:页面与选中对象都会同步到地址栏,便于分享深链。
 *
 *  URL 约定(全部是查询参数,服务端只认路径,所以刷新/直开都不会 404):
 *    /                        → Studio(标注工作区),无平台页
 *    /?page=tasks             → 任意平台页
 *    /?task=12                → 任务详情,直接按 id 拉取
 *    /?ds=/data/xxx           → 某数据集的 Episode 列表(不用 dataset,那个键被 Studio 的旧逻辑占用)
 */
import { useCallback, useSyncExternalStore } from 'react';

export type PlatformPage = 'dashboard' | 'datasets' | 'episodes' | 'tasks' | 'task-create' | 'task-detail' | 'videos' | 'versions' | 'users' | 'qc' | null;

const PAGE_LIST = ['dashboard', 'datasets', 'episodes', 'tasks', 'task-create', 'task-detail', 'videos', 'versions', 'users', 'qc'] as const;

function parsePage(value: string | null): PlatformPage {
  return PAGE_LIST.includes(value as typeof PAGE_LIST[number]) ? value as Exclude<PlatformPage, null> : null;
}

/** 页面之间传递的上下文(当前任务 / 数据集 / episode)。 */
export interface PlatformSelection {
  taskId?: number;
  dataset?: string;
  episode?: number;
}

interface UrlIntent { page: PlatformPage; selection: PlatformSelection; fromUrl: boolean }

function readIntent(): UrlIntent {
  if (typeof window === 'undefined') return { page: 'dashboard', selection: {}, fromUrl: false };
  const params = new URLSearchParams(window.location.search);
  const rawTask = params.get('task') ?? params.get('task_id');
  const taskId = Number(rawTask);
  if (rawTask && Number.isFinite(taskId) && taskId > 0) {
    return { page: 'task-detail', selection: { taskId }, fromUrl: true };
  }
  const dataset = params.get('ds');
  if (dataset) return { page: 'episodes', selection: { dataset }, fromUrl: true };
  const page = parsePage(params.get('page'));
  if (page) return { page: page === 'task-detail' ? 'tasks' : page, selection: {}, fromUrl: true };
  return { page: 'dashboard', selection: {}, fromUrl: false };
}

/** 把当前页面 + 选中对象写回地址栏。用 replaceState,不制造无意义的历史记录。 */
function syncUrl(page: PlatformPage, selection: PlatformSelection) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  let path = '/';
  if (page === 'task-detail' && selection.taskId) {
    params.set('task', String(selection.taskId));
  } else if (page === 'episodes' && selection.dataset) {
    params.set('ds', selection.dataset);
  } else if (page && page !== 'dashboard') {
    params.set('page', page);
  }
  const search = params.toString();
  const url = `${path}${search ? `?${search}` : ''}`;
  if (url !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState({ ...window.history.state, labelvlaPage: page }, '', url);
  }
}

const initial = readIntent();
let currentPage: PlatformPage = initial.page;
let currentSelection: PlatformSelection = initial.selection;
let studioReturnPage: PlatformPage = currentPage || 'tasks';
export function getStudioReturnPage(): PlatformPage { return studioReturnPage; }

const listeners = new Set<() => void>();
const selectionListeners = new Set<() => void>();
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function subscribeSelection(cb: () => void) { selectionListeners.add(cb); return () => { selectionListeners.delete(cb); }; }
const getSnapshot = () => currentPage;
const getSelectionSnapshot = () => currentSelection;

function emit() { for (const l of listeners) l(); }
function emitSelection() { for (const l of selectionListeners) l(); }

if (typeof window !== 'undefined') {
  syncUrl(currentPage, currentSelection);
  window.addEventListener('popstate', () => {
    const next = readIntent();
    currentPage = next.page;
    currentSelection = next.selection;
    if (next.page) studioReturnPage = next.page;
    emitSelection();
    emit();
  });
}

export function usePage(): [PlatformPage, (p: PlatformPage) => void] {
  const page = useSyncExternalStore(subscribe, getSnapshot);
  const setPage = useCallback((p: PlatformPage) => {
    if (p === currentPage) { syncUrl(p, currentSelection); return; }
    if (p === null && currentPage) studioReturnPage = currentPage;
    currentPage = p;
    syncUrl(p, currentSelection);
    emit();
  }, []);
  return [page, setPage];
}

export function useSelection(): [PlatformSelection, (s: PlatformSelection) => void] {
  const selection = useSyncExternalStore(subscribeSelection, getSelectionSnapshot);
  const setSelection = useCallback((s: PlatformSelection) => {
    currentSelection = s;
    syncUrl(currentPage, s);
    emitSelection();
  }, []);
  return [selection, setSelection];
}

/** 登录成功后该落到哪一页:URL 里带了意图就用它,否则按老习惯进数据集页。 */
export function takeLandingPage(): PlatformPage {
  if (initial.fromUrl && initial.page && initial.page !== 'dashboard') return initial.page;
  return 'datasets';
}

/** 登录后恢复页面状态(直接改状态,绕开 setPage 的"同页不重绘"短路)。 */
export function resetPageTo(page: PlatformPage) {
  currentPage = page;
  if (page) studioReturnPage = page;
  syncUrl(page, currentSelection);
  emit();
}
