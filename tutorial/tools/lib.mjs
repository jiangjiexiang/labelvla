// 教程素材生成公共库：无头浏览器 + keynote 式高亮标注 + 逐帧渲染
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

export const API = process.env.LABELVLA_URL || 'http://127.0.0.1:8002';
export const WORK = '/home/robam/labelvla-docker/tutorial/.work';
export const FPS_DIR = path.join(WORK, 'frames');
export const W = 1600, H = 960;
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'zh-CN', deviceScaleFactor: 1 });
  return { browser, ctx };
}

// ───────────── 高亮标注 ─────────────
const CSS = `
#fx-style{--fx:#e11d48}
.fx-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none}
.fx-item{position:absolute;border:3px solid var(--fx);border-radius:10px;box-shadow:0 0 0 4px color-mix(in srgb, var(--fx) 14%, transparent),0 6px 18px rgba(0,0,0,.10);animation:fxIn .26s ease-out both}
.fx-item>b{position:absolute;top:-15px;left:-15px;width:28px;height:28px;border-radius:50%;background:var(--fx);color:#fff;font:700 15px/28px system-ui,"PingFang SC","Microsoft YaHei",sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.28)}
#fx-input-css{}
.fx-typing{position:absolute;pointer-events:none;background:rgba(17,24,39,.92);color:#fff;font:600 13px/1.3 system-ui,"PingFang SC";padding:4px 8px;border-radius:6px;box-shadow:0 6px 16px rgba(0,0,0,.25);white-space:nowrap;transform:translate(14px,16px)}
.fx-typing i{display:inline-block;width:2px;height:12px;background:#fbbf24;margin-left:2px;vertical-align:-2px;animation:fxBlink .9s steps(1) infinite}
@keyframes fxBlink{50%{opacity:0}}
@keyframes fxIn{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:none}}
.fx-caption{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:rgba(17,24,39,.9);color:#fff;padding:9px 18px;border-radius:999px;font:600 16px/1.4 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.22)}
.fx-banner{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(17,24,39,.88);color:#fff;padding:18px 34px;border-radius:16px;font:700 26px/1.4 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35);text-align:center}
`;

/** 按选择器高亮元素；targets=[{sel|selector, label, pad, color}] */
export async function highlight(page, targets, caption, { fadeIn = true } = {}) {
  await page.evaluate(({ targets, caption, css, fadeIn }) => {
    document.querySelectorAll('.fx-layer').forEach((e) => e.remove());
    if (!document.getElementById('fx-style')) {
      const st = document.createElement('style'); st.id = 'fx-style'; st.textContent = css; document.head.appendChild(st);
    }
    const layer = document.createElement('div'); layer.className = 'fx-layer'; document.body.appendChild(layer);
    const locate = (pat) => {
      if (!pat) return null;
      const [sel, text] = pat.split('::');
      try {
        if (!text) return document.querySelector(sel);
        return [...document.querySelectorAll(sel)].find((e) => (e.textContent || '').includes(text)) || null;
      } catch { return null; }
    };
    for (const t of targets) {
      const el = t.loc ? locate(t.loc) : (() => { try { return document.querySelector(t.sel || t.selector); } catch { return null; } })();
      if (!el) { console.warn('missing target', t.sel || t.selector); continue; }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const pad = t.pad ?? 6;
      const d = document.createElement('div');
      d.className = 'fx-item';
      d.style.cssText += `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`
        + `animation-duration:${fadeIn ? 260 : 0}ms;` + (t.color ? `--fx:${t.color};` : '');
      if (t.label !== false) d.innerHTML = `<b>${t.label ?? ''}</b>`;
      layer.appendChild(d);
    }
    if (caption) {
      const c = document.createElement('div'); c.className = 'fx-caption'; c.textContent = caption; layer.appendChild(c);
    }
  }, { targets, caption, css: CSS, fadeIn });
  await sleep(fadeIn ? 420 : 80);
}

/** 按页面坐标矩形高亮（画布内框：拖动目标框、SAM 选区等） */
export async function highlightRects(page, rects, caption) {
  await page.evaluate(({ rects, caption, css }) => {
    document.querySelectorAll('.fx-layer').forEach((e) => e.remove());
    if (!document.getElementById('fx-style')) {
      const st = document.createElement('style'); st.id = 'fx-style'; st.textContent = css; document.head.appendChild(st);
    }
    const layer = document.createElement('div'); layer.className = 'fx-layer'; document.body.appendChild(layer);
    for (const r of rects) {
      const d = document.createElement('div'); d.className = 'fx-item';
      d.style.cssText += `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-radius:${r.round ?? 10}px;`
        + (r.color ? `--fx:${r.color};` : '');
      if (r.label !== false) d.innerHTML = `<b>${r.label ?? ''}</b>`;
      layer.appendChild(d);
    }
    if (caption) { const c = document.createElement('div'); c.className = 'fx-caption'; c.textContent = caption; layer.appendChild(c); }
  }, { rects, caption, css: CSS });
  await sleep(380);
}

/** 角标式说明（不框选任何元素，只用编号 + 说明条）：items=[{sel,label,text}] */
export async function clearFx(page) {
  await page.evaluate(() => document.querySelectorAll('.fx-layer').forEach((e) => e.remove()));
}

// ───────────── 应用操作 ─────────────
export async function login(page) {
  await page.goto(API + '/');
  await page.getByPlaceholder('用户名').fill(process.env.LABELVLA_USER || 'admin');
  await page.getByPlaceholder('密码').fill(process.env.LABELVLA_PASS || 'admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForTimeout(1600);
}

export async function dismissErrorDialog(page) {
  for (let i = 0; i < 3; i++) {
    const d = page.getByRole('dialog');
    if (!(await d.isVisible().catch(() => false))) return;
    const txt = await d.innerText().catch(() => '');
    const btn = /资源加载失败/.test(txt) ? d.getByRole('button', { name: '关闭' }) : d.getByRole('button', { name: /取消|关闭/ });
    await btn.first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

export async function openTask(page, taskId) {
  await page.goto(`${API}/?task=${taskId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
}

export async function openStudio(page, taskId, { fresh = false } = {}) {
  if (fresh) {
    await page.goto(API + '/?page=tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }
  await openTask(page, taskId);
  await page.getByRole('button', { name: /进入工作区/ }).first().click();
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const ready = await page.evaluate(() => {
      const v = document.querySelectorAll('video');
      return v.length > 0 && [...v].every((x) => x.readyState >= 2) && !document.body.innerText.includes('正在连接服务器数据集');
    });
    if (ready) break;
  }
  await page.waitForTimeout(1500);
  if (await page.getByRole('button', { name: '开始标注' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '开始标注' }).click();
    await page.waitForTimeout(2600);
  }
  // URL 被同步成 /?page=tasks，刷新会落到平台页；写址成 Studio，录屏里不暴露内部参数
  await page.evaluate(() => window.history.replaceState({ ...window.history.state, labelvlaPage: null }, '', '/'));
  await dismissErrorDialog(page);
}

export async function enableEdit(page) {
  await page.getByText('编辑', { exact: true }).first().click();
  await page.waitForTimeout(800);
}
/** 若左侧栏已是编辑态（显示“完成”），则不重复点击；重复切换会把编辑态关掉 */
export async function ensureEdit(page) {
  const on = await page.evaluate(() => [...document.querySelectorAll('button,span')].some((e) => (e.innerText || '').trim() === '完成'));
  if (on) return;
  const edit = page.getByText('编辑', { exact: true }).first();
  if (await edit.isVisible().catch(() => false)) await enableEdit(page);
  else await page.locator('aside button').nth(2).click().catch(() => {});
  await page.waitForTimeout(600);
}
/** 右侧面板中某行的输入框（label 文字匹配） */
export function dictInput(page, label) {
  return page.locator('aside label', { hasText: label }).locator('input').first();
}
export async function typeInto(page, locator, text, delay = 40) {
  await locator.click();
  await L_sleep(120);
  await page.keyboard.type(text, { delay });
}
const L_sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function seek(page, f) {
  const s = page.locator('[role=slider]').last();
  const total = Number(await s.getAttribute('aria-valuemax'));
  const r = await s.boundingBox();
  await page.mouse.click(r.x + r.width * (f / total) + 1, r.y + r.height / 2);
  await page.waitForTimeout(380);
}

export async function playButton(page) {
  return page.locator('button').filter({ has: page.locator('svg.lucide-play, svg.lucide-pause') }).last();}

/** 渲染帧：PNG 到 frames/NNNNN.jpg */
let frameNo = 0;
export function frameName() { return path.join(FPS_DIR, String(frameNo++).padStart(5, '0') + '.jpg'); }
export async function snap(page, quality = 82) {
  await page.keyboard.press('Shift');   // 把焦点从输入框移走，避免空格/字母触发播放或字段输入
  const f = frameName();
  await page.screenshot({ path: f, type: 'jpeg', quality });
  return f;
}
export async function shot(page, name, quality = 90) {
  const p = path.join(process.env.SHOT_DIR || path.join(WORK, 'stills'), name + '.jpg');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await page.screenshot({ path: p, type: 'jpeg', quality });
  console.log('  still', name);
  return p;
}
export function resetFrames(dir) {
  fs.rmSync(FPS_DIR, { recursive: true, force: true });
  fs.mkdirSync(FPS_DIR, { recursive: true });
  frameNo = 0;
}
export const totalFrames = () => frameNo;
/** 直接把外部图片文件作为一帧（用于片头、结论卡） */
export function pushImage(file) {
  fs.copyFileSync(file, frameName());
}
export function pushImages(files) { for (const f of files) pushImage(f); }

/** 在页面底部注入说明条（不遮挡内容），items=[{n, text}] */
export async function legend(page, title, items) {
  await page.evaluate(({ title, items }) => {
    document.querySelectorAll('.fx-legend').forEach((e) => e.remove());
    const box = document.createElement('div');
    box.className = 'fx-legend fx-layer';
    Object.assign(box.style, {
      position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)', zIndex: 2147483001,
      display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,.97)',
      border: '1px solid rgba(15,23,42,.14)', borderRadius: '12px', boxShadow: '0 10px 30px rgba(15,23,42,.18)',
      font: '13px/1.5 system-ui,"PingFang SC","Microsoft YaHei",sans-serif', color: '#0f172a', maxWidth: '96vw', flexWrap: 'nowrap', whiteSpace: 'nowrap'
    });
    const badge = (n, color = '#e11d48') => `<b style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:${color};color:#fff;font:700 12px/20px system-ui;justify-content:center;margin-right:6px">${n}</b>`;
    let html = title ? `<b style="font-size:13px;color:#334155">${badge('', '#0f172a')}${title}</b>` : '';
    html = title ? `<b style="font-size:13px;color:#334155;padding-right:4px">${title}</b>` : '';
    html += items.map((it) => `<span style="display:inline-flex;align-items:center;white-space:nowrap">${it.n ? badge(it.n) : ''}${it.text}</span>`).join('<span style="width:1px;height:16px;background:#e2e8f0"></span>');
    box.innerHTML = html;
    document.body.appendChild(box);
  }, { title, items });
  await sleep(150);
}

/** 在视频画面上叠加“框 / 点 / 文字”，模拟标注操作过程 */
export async function canvasFx(page, { rects = [], points = [], label = '' }) {
  await page.evaluate(({ rects, points, label }) => {
    document.querySelectorAll('.fx-canvas').forEach((e) => e.remove());
    const layer = document.createElement('div');
    layer.className = 'fx-canvas';
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 2147482000 });
    for (const r of rects) {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px',
        border: `2px solid ${r.color || '#22c55e'}`, borderRadius: '3px', boxShadow: `0 0 0 1px rgba(0,0,0,.35), 0 0 18px ${r.color || '#22c55e'}55`
      });
      if (r.text) {
        d.innerHTML = `<span style="position:absolute;left:-2px;top:-20px;background:${r.color || '#22c55e'};color:#fff;font:600 11px/18px system-ui;padding:0 6px;border-radius:3px;white-space:nowrap">${r.text}</span>`;
      }
      layer.appendChild(d);
    }
    for (const p of points) {
      const d = document.createElement('div');
      const c = p.positive === false ? '#ef4444' : '#22c55e';
      Object.assign(d.style, {
        position: 'absolute', left: p.x - 9 + 'px', top: p.y - 9 + 'px', width: '18px', height: '18px', borderRadius: '50%',
        border: '3px solid #fff', background: c, boxShadow: `0 0 0 3px ${c}55, 0 2px 6px rgba(0,0,0,.4)`
      });
      layer.appendChild(d);
    }
    if (label) {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%,-50%)', background: 'rgba(17,24,39,.85)',
        color: '#fff', padding: '10px 20px', borderRadius: '10px', font: '600 18px/1.5 system-ui,"PingFang SC"'
      });
      d.textContent = label;
      layer.appendChild(d);
    }
    document.body.appendChild(layer);
  }, { rects, points, label });
}

/** 相机列的可视区域（含居中缩放后的真实画面区域） */
export async function cameraBox(page, idx = 1) {
  const v = page.locator('video').nth(idx);
  const box = await v.boundingBox();
  const dim = await page.evaluate((i) => { const v = document.querySelectorAll('video')[i]; return { w: v.videoWidth, h: v.videoHeight }; }, idx);
  if (!dim.w) return box;
  const scale = Math.min(box.width / dim.w, box.height / dim.h);
  const w = dim.w * scale, h = dim.h * scale;
  return { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h, videoW: dim.w, videoH: dim.h };
}

/** 视频像素坐标 -> 页面坐标 */
export function toPage(cam, vx, vy) {
  return { x: cam.x + (vx / cam.videoW) * cam.width, y: cam.y + (vy / cam.videoH) * cam.height };
}

/** 视频坐标矩形 -> 页面矩形 */
export function rectToPage(cam, x, y, w, h) {
  const p = toPage(cam, x, y);
  return { x: p.x, y: p.y, w: (w / cam.videoW) * cam.width, h: (h / cam.videoH) * cam.height };
}

// ───────────── 录制：自动插入过渡帧 + 鼠标光标 ─────────────
const CURSOR_SVG = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M6 3.2 21.6 14.1l-6.6.9-3.4 6.9z" fill="#111827" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>');
let cursorPos = { x: 800, y: 500 };
export async function initCursor(page) {
  await page.evaluate((src) => {
    document.querySelectorAll('.fx-cursor').forEach((e) => e.remove());
    const img = document.createElement('img');
    img.className = 'fx-cursor';
    img.src = src;
    Object.assign(img.style, { position: 'fixed', left: '0px', top: '0px', width: '28px', height: '28px', zIndex: 2147483002, pointerEvents: 'none', transform: 'translate(-2px,-2px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))', transition: 'left .12s linear, top .12s linear' });
    document.body.appendChild(img);
  }, 'data:image/svg+xml,' + CURSOR_SVG);
  await cursorTo(page, cursorPos.x, cursorPos.y);
}
/** 在光标旁显示“正在输入”的气泡 */
export async function setTyping(page, text, on = true) {
  await page.evaluate(({ text, on, css }) => {
    if (!document.getElementById('fx-style')) {
      const st = document.createElement('style'); st.id = 'fx-style'; st.textContent = css; document.head.appendChild(st);
    }
    let b = document.getElementById('fx-typing');
    if (!on) { b?.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'fx-typing'; b.className = 'fx-typing'; document.body.appendChild(b); }
    b.innerHTML = `${text}<i></i>`;
    const c = document.querySelector('.fx-cursor');
    if (c) { b.style.left = c.style.left; b.style.top = c.style.top; }
  }, { text, on, css: CSS });
  await sleep(60);
}

export async function cursorTo(page, x, y) {
  cursorPos = { x, y };
  await page.evaluate(({ x, y }) => {
    let st = document.getElementById('fx-nocursor');
    if (!st) { st = document.createElement('style'); st.id = 'fx-nocursor'; st.textContent = 'body.recording, body.recording *{cursor:none !important;user-select:none !important}'; document.head.appendChild(st); }
    document.body.classList.add('recording');
    const c = document.querySelector('.fx-cursor');
    if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
  }, { x, y });
}
/** 在页面上点击（同时移动光标），返回是否点中可见元素 */
export async function clickAt(page, x, y) {
  await cursorTo(page, x, y);
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? (el.closest('button,input,select,a,[role=listitem],[role=slider],[role=button]')?.tagName || el.tagName) : null;
  }, { x, y });
  await page.mouse.click(x, y);
  return hit;
}
/** 光标平滑移动到目标中心（边移动边录帧） */
export async function cursorGlide(page, target, steps = 10, holdMs = 0) {
  const to = target.x !== undefined && target.width !== undefined ? { x: target.x + target.width / 2, y: target.y + target.height / 2 } : target;
  const from = { ...cursorPos };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await cursorTo(page, from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await snap(page, 80);
  }
  if (holdMs) await hold(page, holdMs);
}
/** 静止保持 holdMs（按 40ms/帧录制） */
export async function hold(page, ms) {
  const n = Math.max(1, Math.round(ms / 40));
  for (let i = 0; i < n; i++) await snap(page, 80);
}
/** 转场：黑场保持 6 帧（约 0.24s），两端各淡入淡出 5 帧；fadeOut=true 表示“进黑”，默认“从黑出来” */
export async function transition(page, ms = 240, fadeOut = false, blackFrames = 6) {
  if (!fadeOut) {
    for (let i = 0; i < Math.max(blackFrames - 5, 0); i++) { await setFade(page, 1); await snap(page, 80); }
    for (let i = 1; i <= 5; i++) { await setFade(page, 1 - i / 5); await snap(page, 80); }
    await setFade(page, 0);
    for (let i = 0; i < 2; i++) await snap(page, 80);
  } else {
    for (let i = 1; i <= 5; i++) { await setFade(page, i / 5); await snap(page, 80); }
    for (let i = 0; i < Math.max(blackFrames - 5, 0); i++) { await setFade(page, 1); await snap(page, 80); }
  }
}
async function setFade(page, alpha) {
  await page.evaluate((alpha) => {
    let v = document.getElementById('fx-fade');
    if (!v) { v = document.createElement('div'); v.id = 'fx-fade'; Object.assign(v.style, { position: 'fixed', inset: '0', zIndex: 2147483003, pointerEvents: 'none', background: '#0b1220' }); document.body.appendChild(v); }
    v.style.opacity = String(alpha);
  }, alpha);
}
export const mark = (name) => console.log('·', name);

/** locator -> 页面矩形（带外扩） */
export async function rectOf(locator, pad = 0) {
  const b = await locator.boundingBox();
  return { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
}

/** 关闭“资源加载失败”提示框，避免挡住录屏 */
export async function closeIfError(page) {
  try {
    const d = page.getByRole('dialog');
    if (await d.isVisible()) {
      const txt = await d.innerText().catch(() => '');
      if (/资源加载失败/.test(txt)) await d.getByRole('button', { name: '关闭' }).click().catch(() => {});
    }
  } catch { /* ignore */ }
}

/** 清除画面叠加的框/点 */
export async function clearCanvas(page) {
  await page.evaluate(() => document.querySelectorAll('.fx-canvas').forEach((e) => e.remove()));
}

/**
 * 一步一图的标注：在截图上画编号圆圈、高亮框和箭头。
 * items: [{ sel | rect: [x,y,w,h], label: '1', color?: '#e11d48', arrow?: true }]
 * 坐标系为页面像素；arrow 为 true 时从圆圈画一根箭头指向元素中心。
 */
export async function annotateSteps(page, items, { caption = '' } = {}) {
  await page.evaluate(({ items, caption }) => {
    document.querySelectorAll('.fx-steps').forEach((e) => e.remove());
    const layer = document.createElement('div');
    layer.className = 'fx-steps';
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 2147483000 });
    document.body.appendChild(layer);
    const box = (r, color) => {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
        border: `2.5px solid ${color}`, borderRadius: '8px',
        boxShadow: `0 0 0 4px ${color}22`,
      });
      return d;
    };
    const circle = (x, y, label, color) => {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute', left: (x - 15) + 'px', top: (y - 15) + 'px', width: '30px', height: '30px', borderRadius: '50%',
        background: color, color: '#fff', font: '700 15px/30px -apple-system,"PingFang SC",sans-serif',
        textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.28)',
      });
      d.textContent = label;
      return d;
    };
    for (const it of items) {
      const color = it.color || '#e11d48';
      let r;
      if (it.sel) {
        const el = document.querySelector(it.sel);
        if (!el) continue;
        el.scrollIntoView({ block: 'nearest' });
        const b = el.getBoundingClientRect();
        r = { left: b.left - 3, top: b.top - 3, width: b.width + 6, height: b.height + 6 };
      } else {
        const [x, y, w, h] = it.rect;
        r = { left: x, top: y, width: w, height: h };
      }
      layer.appendChild(box(r, color));
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const px = it.pin ? it.pin[0] : r.left - 24, py = it.pin ? it.pin[1] : r.top - 4;
      layer.appendChild(circle(px, py, it.label, color));
      if (it.arrow !== false) {
        const dx = cx - px, dy = cy - py, len = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx) * 180 / Math.PI;
        const a = document.createElement('div');
        Object.assign(a.style, {
          position: 'absolute', left: px + 'px', top: py + 'px', width: Math.max(10, len - 22) + 'px', height: '2px',
          background: color, transformOrigin: '0 50%', transform: `rotate(${ang}deg)`,
        });
        a.innerHTML = `<span style="position:absolute;right:-1px;top:-5px;width:0;height:0;border-left:9px solid ${color};border-top:6px solid transparent;border-bottom:6px solid transparent"></span>`;
        layer.appendChild(a);
      }
    }
    if (caption) {
      const c = document.createElement('div');
      Object.assign(c.style, {
        position: 'absolute', left: '50%', bottom: '14px', transform: 'translateX(-50%)',
        background: 'rgba(17,24,39,.9)', color: '#fff', padding: '8px 16px', borderRadius: '8px',
        font: '600 15px/1.4 -apple-system,"PingFang SC",sans-serif', whiteSpace: 'nowrap',
      });
      c.textContent = caption;
      layer.appendChild(c);
    }
  }, { items, caption });
  await sleep(120);
}

export async function clearSteps(page) {
  await page.evaluate(() => document.querySelectorAll('.fx-steps').forEach((e) => e.remove()));
}
