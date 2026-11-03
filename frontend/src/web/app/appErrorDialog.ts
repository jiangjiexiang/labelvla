/**
 * Last-resort error dialog.
 *
 * Chunk load failures and uncaught errors can happen when the page and the
 * deployed bundle disagree (e.g. a rebuild deletes the old hashed assets).
 * Rendering a bare console message leaves the user with a blank or broken
 * layout, so surface it in a dialog that survives a missing stylesheet: all
 * styling here is inline and the node is mounted outside React.
 */

type DialogOptions = {
  title: string;
  message: string;
  detail?: string;
  actionLabel?: string;
  action?: () => void;
};

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \S+ failed|ChunkLoadError/i;

let dialog: HTMLElement | null = null;
let shown = new Set<string>();

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return CHUNK_ERROR.test(text);
}

function close() {
  dialog?.remove();
  dialog = null;
}

export function showAppError(options: DialogOptions) {
  const key = `${options.title}|${options.message}`;
  if (shown.has(key)) return;
  shown.add(key);
  close();

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px;';
  const card = document.createElement('div');
  card.style.cssText =
    'max-width:640px;width:100%;max-height:80vh;overflow:auto;background:#fff;color:#0f172a;border-radius:12px;box-shadow:0 24px 64px rgba(15,23,42,.28);padding:24px;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;';
  const title = document.createElement('h2');
  title.textContent = options.title;
  title.style.cssText = 'margin:0 0 8px;font-size:17px;font-weight:600;';
  const message = document.createElement('p');
  message.textContent = options.message;
  message.style.cssText = 'margin:0 0 12px;color:#475569;white-space:pre-wrap;';
  card.append(title, message);

  if (options.detail) {
    const detail = document.createElement('pre');
    detail.textContent = options.detail;
    detail.style.cssText =
      'margin:0 0 16px;padding:10px 12px;max-height:220px;overflow:auto;background:#f1f5f9;border-radius:8px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;';
    card.append(detail);
  }

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const button = (label: string, primary: boolean, onClick: () => void) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = [
      'padding:8px 16px',
      'border-radius:8px',
      'font-size:13px',
      'cursor:pointer',
      primary ? 'background:#0f172a;color:#fff;border:1px solid #0f172a' : 'background:#fff;color:#0f172a;border:1px solid #cbd5e1',
    ].join(';');
    el.onclick = onClick;
    return el;
  };
  if (options.action) {
    actions.append(button(options.actionLabel ?? '继续', true, () => {
      close();
      options.action?.();
    }));
  }
  actions.append(button('关闭', !options.action, close));
  card.append(actions);
  overlay.append(card);
  dialog = overlay;

  const attach = () => document.body.appendChild(overlay);
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });
}

/** Route an unexpected error to the dialog, ignoring user-initiated aborts. */
export function reportAppError(error: unknown) {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'CancelledError') return;
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (!text) return;
  if (isChunkLoadError(error)) {
    showAppError({
      title: '页面资源已更新',
      message:
        '服务端刚发布了新版本，当前页面还在引用已被替换的旧文件（动态模块加载失败）。\n刷新页面后重新进入即可；未保存的标注会丢失，请先确认。',
      detail: text,
      actionLabel: '刷新页面',
      action: () => window.location.reload(),
    });
    return;
  }
  showAppError({
    title: '出错了',
    message: '页面遇到未处理的错误，可以刷新后重试。若持续出现，请把下面的详情发给管理员。',
    detail: error instanceof Error ? (error.stack || error.message) : text,
  });
}
