// 截图：SAM 面板就绪、点选结果（输出到 ../images）
import * as L from '/home/robam/labelvla-docker/tutorial/tools/lib.mjs';
const TASK = Number(process.env.TASK_ID || 10);
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
await L.login(page);
await L.openStudio(page, TASK, { fresh: true });
const tb = await page.locator('[role=list]').last().boundingBox();
await page.mouse.click(tb.x + 30, tb.y + tb.height / 2);
await page.waitForTimeout(900);
const sam = page.getByRole('button', { name: 'SAM 点选分割' });
if (!(await sam.isVisible().catch(() => false))) { console.log('no SAM entry'); await browser.close(); process.exit(1); }
await sam.click();
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(800);
  if (/SAM 就绪/.test(await page.locator('aside').innerText())) break;
}
await page.waitForTimeout(600);
await L.shot(page, '18-sam-ready');
const cam = await L.cameraBox(page, 1);
const pt = L.toPage(cam, 422, 333);
await page.mouse.move(pt.x, pt.y);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(3500);
await L.dismissErrorDialog(page).catch(() => {});
await page.waitForTimeout(1500);
await page.mouse.move(pt.x + 4, pt.y + 4);
await L.shot(page, '19-sam-point');
await browser.close();
console.log('ok');
