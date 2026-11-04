// 文档风录屏（三）：审核（视频质检、通过、程序质检、发布）→ 版本记录
import * as L from './lib_doc.mjs';

const TASK = Number(process.env.TASK_ID || 10);
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
L.resetFrames();
await L.login(page);
await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}*,*::before,*::after{caret-color:transparent !important;user-select:none !important}' });
await page.goto(L.API + '/?task=' + TASK, { waitUntil: 'networkidle' });
await L.addNoteStyle(page);
await L.note(page, '标注完成，任务进入「人工验收」，由审核人把关', '9');
await L.hold(page, 1500);
await page.evaluate(() => window.scrollBy(0, 430));
await L.hold(page, 1200);

// 审核人打开视频质检
const view = page.getByRole('button', { name: /查看视频质检/ }).first();
if (await view.isVisible().catch(() => false)) {
  const b = await view.boundingBox();
  await L.cursor(page, b.x + b.width / 2, b.y + b.height / 2);
  await view.click();
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(400);
    const ready = await page.evaluate(() => { const v = document.querySelectorAll('video'); return v.length > 0 && [...v].every((x) => x.readyState >= 2); });
    if (ready) break;
  }
  await page.waitForTimeout(1200);
  await L.hideCursor(page);
  await L.note(page, '审核人进入工作区：只读，逐条检查片段和目标框', '10');
  await L.hold(page, 2000);
  const play = await L.playButton(page);
  if (await play.isVisible().catch(() => false)) {
    await play.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) { await L.snap(page, 92); }
    await play.click();
  }
  await page.waitForTimeout(500);
  await page.goto(L.API + '/?task=' + TASK, { waitUntil: 'networkidle' });
  await L.addNoteStyle(page);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollBy(0, 430));
  await L.hold(page, 1000);
}

// 质检通过（第一次确认视频，第二次确认后打包）
await page.evaluate(() => { window.__logs = []; window.confirm = (m) => { window.__logs.push(m); return true; }; });
for (let round = 1; round <= 3; round++) {
  const pass = page.getByRole('button', { name: '质检通过' }).first();
  if (!(await pass.isVisible().catch(() => false))) break;
  const b = await pass.boundingBox();
  await L.note(page, round === 1 ? '视频确认无误，点「质检通过」' : '再次确认后，系统打包并发布新版本', String(9 + round));
  await L.cursor(page, b.x + b.width / 2, b.y + b.height / 2);
  await L.hold(page, 600);
  await pass.click();
  await page.waitForTimeout(2500);
  await L.dismissErrorDialog(page).catch(() => {});
  await L.hold(page, 1200);
  await page.evaluate(() => window.scrollBy(0, 260));
  await L.hold(page, 900);
}
// 等待流程走完
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(400);
  await L.closeIfError(page).catch(() => {});
  const t = await page.locator('body').innerText();
  if (/已完成/.test(t)) break;
  if (i % 5 === 0) await L.snap(page, 92);
}
await page.waitForTimeout(1200);
await L.hideCursor(page);
await L.note(page, '程序质检与版本发布自动完成，任务状态变为「已完成」', '13');
await page.evaluate(() => window.scrollTo(0, 0));
await L.hold(page, 2200);
await L.note(page, null);

// 版本管理
await page.goto(L.API + '/?page=versions', { waitUntil: 'networkidle' });
await L.addNoteStyle(page);
await L.note(page, '版本管理：每次发布都是独立版本，可下载校验过的数据包', '14');
await L.hold(page, 2200);
await L.note(page, null);
await L.hold(page, 600);
console.log('frames', L.totalFrames());
await browser.close();
