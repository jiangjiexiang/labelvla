// 生成教程静帧：数字截图，配合 HTML 里的步骤说明
import * as L from './lib.mjs';
import fs from 'fs';
process.env.SHOT_DIR = '/home/robam/labelvla-docker/tutorial/images';
const OUT = process.env.SHOT_DIR;
fs.mkdirSync(OUT, { recursive: true });
const S = (n) => L.shot(page, n);

const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
const TASK = Number(process.env.TASK_ID || 10);

// ── 01 登录 ──
await page.goto(L.API + '/');
await page.waitForTimeout(700);
await L.highlight(page, [
  { sel: 'input[placeholder="用户名"]', label: 1 },
  { sel: 'input[placeholder="密码"]', label: 2 },
  { sel: 'form button[type=submit]', label: 3 },
], '');
await S('01-login');

await L.login(page);

// ── 02 数据看板 ──
await page.goto(L.API + '/?page=dashboard', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
await L.highlight(page, [{ sel: '.g-main > *:nth-child(1)', label: 1, pad: 8 }], '');
await S('02-dashboard');

// ── 03 数据管理 ──
await page.goto(L.API + '/?page=datasets', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
const dsRow = page.locator('table tbody tr', { hasText: 'tutorial_demo_template' }).first();
await L.highlightRects(page, [await L.rectOf(dsRow, 6)], '');
await S('03-datasets');

// ── 04 Episode 列表 ──
await page.goto(L.API + '/?ds=/data/tutorial_demo_template', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
await L.highlight(page, [{ sel: '.g-main table', label: 1, pad: 8 }], '');
await S('04-episodes');

// ── 05 新建任务 ──
await page.goto(L.API + '/?page=task-create', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
await L.highlight(page, [
  { loc: 'label::关联数据集', label: 1 },
  { loc: 'label::分配给', label: 2 },
  { loc: 'label::审核负责人', label: 3 },
], '');
await S('05-task-create');
await L.clearFx(page);

// ── 06 任务详情 ──
await L.openTask(page, TASK);
await page.waitForTimeout(600);
await L.highlight(page, [
  { sel: '.g-detail-overview', label: 1, pad: 8 },
  { sel: '.g-node-card', label: 2, pad: 8 },
], '');
await S('06-task-detail');
await L.clearFx(page);

// ── 07 工作区总览 ──
await L.openStudio(page, TASK, { fresh: true });
await page.waitForTimeout(800);
await L.legend(page, '标注工作台', [
  { n: 1, text: '左侧 Episode 列表' },
  { n: 2, text: '三路相机画面' },
  { n: 3, text: '折线图 / 原始消息' },
  { n: 4, text: 'Subtask 片段轨道与播放控制' },
  { n: 5, text: '右侧标注面板' },
]);
await S('07-studio-overview');
await L.clearFx(page);

// ── 08 划片段对话框 ──
await L.ensureEdit(page);
const gap = page.locator('[role=listitem]').first();
const gb = await gap.boundingBox();
await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.waitForTimeout(800);
const dlg = page.getByRole('dialog');
if (await dlg.isVisible().catch(() => false)) {
  await dlg.locator('input').first().fill('抓取食物');
  await page.waitForTimeout(300);
  await L.highlight(page, [{ sel: '[role=dialog] input', label: 1 }, { sel: '[role=dialog] button:has-text("保存")', label: 2 }], '');
  await S('08-subtask-dialog');
  await dlg.getByRole('button', { name: '取消' }).click().catch(() => dlg.getByRole('button', { name: 'Close' }).click().catch(() => {}));
}
await L.clearFx(page);
await page.waitForTimeout(600);

// ── 09 右侧标注面板 ──
const tb = await page.locator('[role=list]').last().boundingBox();
await page.mouse.click(tb.x + 20, tb.y + tb.height / 2);
await page.waitForTimeout(900);
await L.highlight(page, [
  { sel: 'aside', label: 1, pad: 4 },
], '');
await S('09-annotation-panel');
await L.clearFx(page);

// ── 10 SAM 入口 ──
const samBtn = page.getByRole('button', { name: 'SAM 点选分割' });
if (await samBtn.isVisible().catch(() => false)) {
  await L.highlight(page, [{ sel: 'aside', label: false, pad: 4 }], '');
  const b = await L.rectOf(samBtn, 6);
  await L.highlightRects(page, [b], '');
  await S('10-sam-entry');
}

// ── 11 版本管理 ──
await page.goto(L.API + '/?page=versions', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
await S('11-versions');

// ── 12 用户管理 ──
await page.goto(L.API + '/?page=users', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
await S('12-users');

await browser.close();
console.log('done');
