// 重截「保存」相关截图：顶部保存修改 → 已保存；右侧面板保存
import * as L from '/home/robam/labelvla-docker/tutorial/tools/lib.mjs';
import fs from 'fs';
const TASK = Number(process.env.TASK_ID || 10);
const OUT = '/home/robam/labelvla-docker/tutorial/images/steps';
fs.mkdirSync(OUT, { recursive: true });
process.env.SHOT_DIR = OUT;
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent !important;scroll-behavior:auto !important}' });
await L.login(page);
await L.openStudio(page, TASK, { fresh: true });
await page.waitForTimeout(900);
await L.ensureEdit(page);

const shot = async (n) => { await L.shot(page, n); await L.clearSteps(page); };

// 让工作区产生未保存改动：在轨道上点一下新建片段再取消，确保「未保存」出现
const tb = await page.locator('[role=list]').last().boundingBox();
await page.mouse.click(tb.x + 40, tb.y + 8);
await page.waitForTimeout(800);
const dlg = page.getByRole('dialog');
if (await dlg.isVisible().catch(() => false)) await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 顶部：保存修改 + 保存状态
{
  const save = page.getByText('保存修改', { exact: true }).first();
  const sb = await save.boundingBox();
  const stateText = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /未保存|已保存/.test(n.textContent));
    return el ? el.textContent.trim() : null;
  });
  const st = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /未保存|已保存/.test(n.textContent));
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: el.textContent.trim() };
  });
  const items = [{ rect: [sb.x - 6, sb.y - 6, sb.width + 12, sb.height + 12], label: '1' }];
  if (st) items.push({ rect: [st.x - 8, st.y - 8, st.w + 16, st.h + 16], label: '2', color: '#f59e0b', arrow: false, pin: [st.x + st.w + 16, st.y - 2] });
  await L.annotateSteps(page, items, { caption: `① 保存修改　② 保存状态：${stateText || '未保存'}` });
}
await shot('save-1');

// 点保存修改，等「已保存」
await page.getByText('保存修改', { exact: true }).first().click({ force: true });
let ok = false;
for (let i = 0; i < 80; i++) { await page.waitForTimeout(500); const t = await page.locator('body').innerText(); if (/已保存/.test(t)) { ok = true; break; } if (/失败/.test(t)) break; }
await page.waitForTimeout(1200);
console.log('saved:', ok);
{
  const st = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /已保存/.test(n.textContent));
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const saveBtn = await page.getByText('保存修改', { exact: true }).first().boundingBox();
  const items = [];
  if (saveBtn) items.push({ rect: [saveBtn.x - 6, saveBtn.y - 6, saveBtn.width + 12, saveBtn.height + 12], label: '1', arrow: false });
  if (st) items.push({ rect: [st.x - 8, st.y - 8, st.w + 16, st.h + 16], label: '2', color: '#16a34a', arrow: false });
  await L.annotateSteps(page, items, { caption: '点「保存修改」后状态变成「已保存」' });
}
await shot('save-2');

// 右侧面板的保存按钮
{
  await L.ensureEdit(page);
  const aside = page.locator('aside').first();
  const btn = aside.getByRole('button', { name: /^保存$/ }).first();
  const bb = await btn.boundingBox().catch(() => null);
  if (bb) {
    await L.annotateSteps(page, [{ rect: [bb.x - 6, bb.y - 6, bb.width + 12, bb.height + 12], label: '1', color: '#2563eb' }],
      { caption: '面板右上角「保存」只保存当前 Episode' });
    await shot('save-3');
  } else console.log('panel save not found');
}
await browser.close();
