// 重截 SAM 点选那张：确保画面上只有本次点选的一个轮廓
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
await page.waitForTimeout(700);
await L.ensureEdit(page);
// 选中片段
const tb = await page.locator('[role=list]').last().boundingBox();
await page.mouse.click(tb.x + 20, tb.y + 8);
await page.waitForTimeout(800);
// 关掉「分割轮廓预览」，这样只显示本次点选结果
const toggle = page.getByRole('button', { name: /分割轮廓预览/ });
if (await toggle.isVisible().catch(() => false)) {
  const label = await toggle.innerText();
  if (label.includes('开')) { await toggle.click(); await page.waitForTimeout(400); }
}
// 打开 SAM，等会话就绪
await page.getByRole('button', { name: 'SAM 点选分割' }).click();
for (let i = 0; i < 60; i++) { await page.waitForTimeout(800); if (/SAM 就绪/.test(await page.locator('aside').innerText())) break; }
await page.waitForTimeout(600);
// 点选目标（只点一次，不加负点）
const cam = await L.cameraBox(page, 1);
const pt = L.toPage(cam, 422, 333);
await page.mouse.move(pt.x, pt.y);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(4000);
await L.dismissErrorDialog(page).catch(() => {});
await page.waitForTimeout(1500);
// 检查画面里是否只剩本次对象：打印面板状态
console.log('status:', (await page.locator('aside').innerText()).match(/对象 #[^\n]*/)?.[0]);
await L.annotateSteps(page, [{ rect: [pt.x - 14, pt.y - 14, 28, 28], label: '1', color: '#16a34a', arrow: false }], {});
await L.shot(page, 'sam-3');
await L.clearSteps(page);
await browser.close();
