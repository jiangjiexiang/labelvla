// 文档风录屏：一次连续录制，不插卡片、不做黑场；说明直接画在页面上
export * from './lib.mjs';
import * as L from './lib.mjs';

const NOTE_CSS = `
#fx-note{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483003;
  background:#111827;color:#f8fafc;font:600 15px/1.45 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  padding:9px 16px 9px 14px;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.22);white-space:nowrap}
#fx-note i{display:inline-flex;width:20px;height:20px;border-radius:50%;background:#fff;color:#111827;font:700 12px/20px system-ui;
  align-items:center;justify-content:center;margin-right:8px;font-style:normal}
#fx-spot{position:fixed;border:2px solid #111827;border-radius:6px;z-index:2147483002;pointer-events:none;
  box-shadow:0 0 0 4px rgba(17,24,39,.10)}
`;

export async function addNoteStyle(page) {
  await page.addStyleTag({ content: NOTE_CSS + 'html{scroll-behavior:auto !important}*,*::before,*::after{caret-color:transparent !important;user-select:none !important}' });
}
export async function note(page, text, step) {
  await page.evaluate(({ text, step }) => {
    let el = document.getElementById('fx-note');
    if (!text) { el?.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'fx-note'; document.body.appendChild(el); }
    el.innerHTML = (step ? `<i>${step}</i>` : '') + text;
  }, { text, step });
}
export async function spot(page, selector, pad = 5) {
  await page.evaluate(({ selector, pad }) => {
    document.querySelectorAll('#fx-spot').forEach((e) => e.remove());
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.id = 'fx-spot';
    d.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    document.body.appendChild(d);
  }, { selector, pad });
}
export async function clearSpot(page) { await spot(page, null); }

/** 在 xy 处显示点击提示圈（不用系统光标） */
export async function cursor(page, x, y) {
  await page.evaluate(({ x, y }) => {
    let c = document.getElementById('fx-pt');
    if (!c) {
      c = document.createElement('div'); c.id = 'fx-pt';
      c.style.cssText = 'position:fixed;width:18px;height:18px;border-radius:50%;border:2.5px solid #111827;background:rgba(255,255,255,.85);z-index:2147483003;pointer-events:none;transition:left .18s ease,top .18s ease';
      document.body.appendChild(c);
    }
    c.style.left = x - 9 + 'px'; c.style.top = y - 9 + 'px';
  }, { x, y });
}
export async function hideCursor(page) { await page.evaluate(() => document.getElementById('fx-pt')?.remove()); }

/** 保持：静止画面只录 2 帧，靠正文文字控制节奏 */
export async function hold(page, ms) {
  // 静帧按 20fps 节奏录，避免整段视频被压成几秒
  const n = Math.max(4, Math.round(ms / 50));
  for (let i = 0; i < n; i++) await L.snap(page, 92);
}
export async function clickPoint(page, x, y) {
  await cursor(page, x, y);
  await L.snap(page, 92);
  await page.mouse.click(x, y);
  await L.snap(page, 92);
}
