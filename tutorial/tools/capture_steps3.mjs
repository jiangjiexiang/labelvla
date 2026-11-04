// 审核与发布步骤截图
import * as L from '/home/robam/labelvla-docker/tutorial/tools/lib.mjs';
import fs from 'fs';
const TASK = Number(process.env.TASK_ID || 10);
const OUT = '/home/robam/labelvla-docker/tutorial/images/steps';
fs.mkdirSync(OUT, { recursive: true });
process.env.SHOT_DIR = OUT;
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent !important;scroll-behavior:auto !important}' });
const shot = async (n) => { await L.shot(page, n); await L.clearSteps(page); };
await L.login(page);
await L.openTask(page, TASK);
await page.waitForTimeout(600);
await page.evaluate(() => window.scrollBy(0, 430));
await page.waitForTimeout(400);

// 人工验收节点：查看视频质检 / 质检通过 / 打回重标
{
  const view = page.getByRole('button', { name: /查看视频质检/ }).first();
  const pass = page.getByRole('button', { name: '质检通过' }).first();
  const rej = page.getByRole('button', { name: '打回重标' }).first();
  const items = [];
  const vb = await view.boundingBox(); if (vb) items.push({ rect: [vb.x - 3, vb.y - 3, vb.width + 6, vb.height + 6], label: '1', arrow: false });
  const pb = await pass.boundingBox(); if (pb) items.push({ rect: [pb.x - 3, pb.y - 3, pb.width + 6, pb.height + 6], label: '2', color: '#16a34a', arrow: false });
  const rb = await rej.boundingBox(); if (rb) items.push({ rect: [rb.x - 3, rb.y - 3, rb.width + 6, rb.height + 6], label: '3', color: '#f59e0b', arrow: false });
  await L.annotateSteps(page, items, { caption: '审核人：1 查看视频　2 通过　3 打回' });
}
await shot('review-1');

// 只读的工作区
{
  const view = page.getByRole('button', { name: /查看视频质检/ }).first();
  if (await view.isVisible().catch(() => false)) {
    await view.click();
    for (let i = 0; i < 80; i++) { await page.waitForTimeout(400); const ok = await page.evaluate(() => { const v = document.querySelectorAll('video'); return v.length && [...v].every((x) => x.readyState >= 2); }); if (ok) break; }
    await page.waitForTimeout(1500);
    const aside = await page.locator('aside').first().boundingBox();
    await L.annotateSteps(page, [{ rect: [aside.x, aside.y, aside.width, 120], label: '1', color: '#2563eb' }], { caption: '审核模式下标注面板只读，只能通过或打回' });
    await shot('review-2');
    await page.goto(L.API + '/?task=' + TASK, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollBy(0, 430));
    await page.waitForTimeout(500);
  }
}

// 质检通过 → 程序质检 → 版本发布
await page.evaluate(() => { window.confirm = () => true; });
for (let round = 0; round < 2; round++) {
  const pass = page.getByRole('button', { name: '质检通过' }).first();
  if (!(await pass.isVisible().catch(() => false))) break;
  const b = await pass.boundingBox();
  if (round === 0) {
    await L.annotateSteps(page, [{ rect: [b.x - 3, b.y - 3, b.width + 6, b.height + 6], label: '1', color: '#16a34a' }], { caption: '点「质检通过」确认视频' });
    await shot('review-3');
  }
  await pass.click();
  await page.waitForTimeout(2500);
  await L.dismissErrorDialog(page).catch(() => {});
  await page.evaluate(() => window.scrollBy(0, 260));
  await page.waitForTimeout(800);
}
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(400);
  await L.closeIfError(page).catch(() => {});
  if (/已完成/.test(await page.locator('body').innerText())) break;
}
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
{
  const node = await page.locator('.g-node-card').boundingBox();
  const aside = await page.locator('.g-detail-overview > aside').boundingBox();
  const items = [{ rect: [aside.x - 4, aside.y - 4, aside.width + 8, aside.height + 8], label: '1', arrow: false }];
  if (node) items.push({ rect: [node.x, node.y, node.width, Math.min(node.height, 330)], label: '2', color: '#16a34a', arrow: false });
  await L.annotateSteps(page, items, { caption: '任务状态变为「已完成」，五个节点全部通过' });
}
await shot('release-1');
console.log('done part3');
await browser.close();
