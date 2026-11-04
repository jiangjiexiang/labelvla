// 文档风录屏（一）：登录 → 建任务 → 进工作区
import * as L from './lib_doc.mjs';

const TASK = Number(process.env.TASK_ID || 10);
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
L.resetFrames();

await page.goto(L.API + '/');
await L.addNoteStyle(page);
await L.hold(page, 900);
await L.note(page, '登录：账号 admin / admin123', '1');
await L.hold(page, 1600);
await page.fill('input[placeholder="用户名"]', 'admin');
await page.fill('input[placeholder="密码"]', 'admin123');
await page.locator('form button[type="submit"]').click();
await page.waitForTimeout(1500);
await L.hold(page, 1400);

await page.goto(L.API + '/?page=datasets', { waitUntil: 'networkidle' });
await L.addNoteStyle(page);
await L.note(page, '数据管理：找到 tutorial_demo_template', '2');
const row = page.locator('table tbody tr', { hasText: 'tutorial_demo_template' }).first();
await L.spot(page, 'table tbody tr:nth-child(8)');
await L.hold(page, 1800);
await L.clearSpot(page);

await page.goto(L.API + '/?page=task-create', { waitUntil: 'networkidle' });
await L.addNoteStyle(page);
await L.note(page, '新建任务：任务名 + 数据集 + 标注人 + 审核人', '3');
await L.hold(page, 900);
await page.getByLabel('任务名称').fill('tutorial_demo_template · 抓取动作标注');
await page.getByLabel('关联数据集').selectOption('/data/tutorial_demo_template');
await page.getByLabel('分配给').selectOption('zhang');
await page.getByLabel('审核负责人').selectOption('lily');
await L.hold(page, 1800);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await L.hold(page, 1400);

await page.goto(L.API + '/?task=' + TASK, { waitUntil: 'networkidle' });
await L.addNoteStyle(page);
await L.note(page, '任务详情：五个节点，标注节点等待人工', '4');
await L.hold(page, 1500);
await page.evaluate(() => window.scrollBy(0, 430));
await L.hold(page, 1500);
const enter = page.getByRole('button', { name: '进入工作区' }).first();
const b = await enter.boundingBox();
await L.cursor(page, b.x + b.width / 2, b.y + b.height / 2);
await L.hold(page, 700);
await enter.click();
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(400);
  const ready = await page.evaluate(() => { const v = document.querySelectorAll('video'); return v.length > 0 && [...v].every((x) => x.readyState >= 2); });
  if (ready) break;
}
await page.waitForTimeout(1500);
await L.hideCursor(page);
await L.note(page, '标注工作台：左侧 Episode，中间相机，右侧标注面板', '5');
await L.hold(page, 2600);
await L.note(page, null);
console.log('frames', L.totalFrames());
await browser.close();
