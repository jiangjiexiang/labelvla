import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import App from './App.tsx';
import { reportAppError, showAppError } from './app/appErrorDialog';

window.addEventListener(
  'error',
  (event) => {
    console.error('[Global Error]:', event.message, event.filename, event.error);
    if (event.message) reportAppError(event.error ?? event.message);
  },
  true,
);

// Resource failures (script/link/wasm) do not carry a message: the browser
// fires an error event on the element itself instead.
window.addEventListener(
  'error',
  (event) => {
    const target = event.target as HTMLElement | null;
    const source = target?.getAttribute('src') ?? target?.getAttribute('href') ?? '';
    console.error('[Resource Error]:', target?.tagName, source);
    if (!source) return;
    showAppError({
      title: '页面资源加载失败',
      message: '服务端刚发布了新版本，浏览器仍在使用旧文件。刷新页面后重新进入即可。',
      detail: source,
      actionLabel: '刷新页面',
      action: () => window.location.reload(),
    });
  },
  true,
);

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]:', event.reason);
  reportAppError(event.reason);
});

function renderApp() {
  const container = document.getElementById('lerobot-root') || document.getElementById('root');
  if (!container) {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', renderApp);
    } else {
      console.error('Target container #lerobot-root not found. Please check index.html.');
    }
    return;
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  requestAnimationFrame(() => {
    window.__APP_LOADER_DONE__?.();
  });
}

renderApp();
