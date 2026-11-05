// 按角色截屏：管理员（数据看板、用户管理、数据集操作）、标注员、审核员
import * as L from '/home/robam/labelvla-docker/tutorial/tools/lib.mjs';
import fs from 'fs';
const OUT = '/home/robam/labelvla-docker/tutorial/images/steps';
fs.mkdirSync(OUT, { recursive: true });
process.env.SHOT_DIR = OUT;
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent !important;scroll-behavior:auto !important}' });
const shot = async (n) => { await L.shot(page, n); await L.clearSteps(page); };
const box = (loc) => loc.boundingBox();

// ── 管理员 ──
await L.login(page);   // admin
await page.goto(L.API + '/?page=dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
{
  const cards = page.locator('.g-page').first();
  await L.annotateSteps(page, [{ rect: [0, 0, 0, 0], label: '' }].slice(0, 0), {});
  await L.clearSteps(page);
  await L.annotateSteps(page, [], { caption: '数据看板：标注进度、质检通过率、近期趋势' });
}
await shot('admin-1');

await page.goto(L.API + '/?page=users', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
{
  const create = page.getByRole('button', { name: /新建账号|新增用户|新建用户/ }).first();
  const cb = await create.isVisible().catch(() => false) ? await create.boundingBox() : null;
  const firstRole = await page.locator('select[aria-label^="修改"]').first().boundingBox().catch(() => null);
  const items = [];
  if (cb) items.push({ rect: [cb.x - 4, cb.y - 4, cb.width + 8, cb.height + 8], label: '1', arrow: false });
  if (firstRole) items.push({ rect: [firstRole.x - 4, firstRole.y - 4, firstRole.width + 8, firstRole.height + 8], label: '2', arrow: false });
  await L.annotateSteps(page, items, { caption: '用户管理：1 新建账号　2 改角色' });
}
await shot('admin-2');

await page.goto(L.API + '/?page=datasets', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
{
  const rescan = page.getByRole('button', { name: /重新扫描/ }).first();
  const rb = await rescan.isVisible().catch(() => false) ? await rescan.boundingBox() : null;
  await L.annotateSteps(page, rb ? [{ rect: [rb.x - 4, rb.y - 4, rb.width + 8, rb.height + 8], label: '1' }] : [],
    { caption: '数据集放进 data/ 后，点右上角「重新扫描」' });
}
await shot('admin-3');

// ── 审核员 lily ──
await ctx.clearCookies();
const p2 = await ctx.newPage();
await p2.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent !important}' });
process.env.LABELVLA_USER = 'lily';
process.env.LABELVLA_PASS = 'demo123';
await p2.goto(L.API + '/');
await p2.getByPlaceholder('用户名').fill('lily');
await p2.getByPlaceholder('密码').fill('demo123');
await p2.getByRole('button', { name: '登录' }).click();
await p2.waitForTimeout(2000);
await p2.goto(L.API + '/?page=qc', { waitUntil: 'networkidle' });
await p2.waitForTimeout(1500);
{
  const top = await p2.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => /扫描/.test(b.innerText));
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await L.annotateSteps(p2, top ? [{ rect: [top.x - 4, top.y - 4, top.w + 8, top.h + 8], label: '1' }] : [],
    { caption: '质检管理：对数据集跑一遍程序质检，逐条跳到问题帧' });
}
await L.shot(p2, 'reviewer-1');
await L.clearSteps(p2);

await p2.goto(L.API + '/?task=10', { waitUntil: 'networkidle' });
await p2.waitForTimeout(1200);
await p2.evaluate(() => window.scrollTo(0, 0));
{
  const note = await p2.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /指定负责人/.test(n.textContent));
    return el ? (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })() : null;
  });
  await L.annotateSteps(p2, note ? [{ rect: [note.x - 8, note.y - 8, note.w + 16, note.h + 16], label: '1', arrow: false }] : [],
    { caption: '审核员看到的任务：等标注负责人提交后才能验收' });
}
await L.shot(p2, 'reviewer-2');
await L.clearSteps(p2);
console.log('done roles');
await browser.close();
