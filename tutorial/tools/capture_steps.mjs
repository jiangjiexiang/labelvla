// 一步一步截图 + 标注：每张图只讲一步，编号圆圈与箭头按实际元素位置生成
import * as L from '/home/robam/labelvla-docker/tutorial/tools/lib.mjs';
import fs from 'fs';

const TASK = Number(process.env.TASK_ID || 10);
const OUT = '/home/robam/labelvla-docker/tutorial/images/steps';
fs.mkdirSync(OUT, { recursive: true });
process.env.SHOT_DIR = OUT;

const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent !important;scroll-behavior:auto !important}' });
const box = async (loc) => loc.boundingBox();
const shot = async (name) => { await L.shot(page, name); await L.clearSteps(page); };

// ───────── 登录 ─────────
await page.goto(L.API + '/');
await page.waitForTimeout(800);
await L.annotateSteps(page, [
  { sel: 'input[placeholder="用户名"]', label: '1' },
  { sel: 'input[placeholder="密码"]', label: '2' },
  { sel: 'form button[type=submit]', label: '3' },
]);
await shot('login-1');
await page.fill('input[placeholder="用户名"]', 'admin');
await page.fill('input[placeholder="密码"]', 'admin123');
await page.locator('form button[type=submit]').click();
await page.waitForTimeout(2000);

// ───────── 数据管理 ─────────
await page.goto(L.API + '/?page=datasets', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const row = page.locator('table tbody tr', { hasText: 'tutorial_demo_template' }).first();
await L.annotateSteps(page, [{ rect: (await box(row)).x != null ? [0, 0, 0, 0] : null, label: '' }].filter(Boolean), {}).catch(() => {});
await L.clearSteps(page);
{
  const b = await box(row);
  const nameLink = row.locator('a, button').first();
  const nb = await box(nameLink).catch(() => null);
  await L.annotateSteps(page, [
    { rect: [b.x, b.y, b.width, b.height], label: '1', arrow: false },
    ...(nb ? [{ rect: [nb.x, nb.y, nb.width, nb.height], label: '2', color: '#2563eb', pin: [nb.x - 26, nb.y - 6] }] : []),
  ], { caption: '1 找到数据集　2 点名称进入 Episode 列表' });
}
await shot('datasets-1');

// ───────── 新建任务 ─────────
await page.goto(L.API + '/?page=task-create', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await L.annotateSteps(page, [
  { sel: 'label:nth-of-type(1) input', pin: [0, 0] },
].slice(0, 0));
await L.clearSteps(page);
{
  const name = await box(page.getByLabel('任务名称'));
  const ds = await box(page.getByLabel('关联数据集'));
  const as = await box(page.getByLabel('分配给'));
  const rv = await box(page.getByLabel('审核负责人'));
  await L.annotateSteps(page, [
    { rect: [name.x - 4, name.y + name.height - 40, name.width + 8, 44], label: '1', arrow: false },
    { rect: [ds.x - 4, ds.y + ds.height - 40, ds.width + 8, 44], label: '2', arrow: false },
    { rect: [as.x - 4, as.y + as.height - 40, as.width + 8, 44], label: '3', arrow: false },
    { rect: [rv.x - 4, rv.y + rv.height - 40, rv.width + 8, 44], label: '4', arrow: false },
  ], { caption: '1 任务名称　2 数据集　3 标注负责人　4 审核负责人' });
}
await shot('task-create-1');

// 填完的样子
await page.getByLabel('任务名称').fill('tutorial_demo_template · 抓取动作标注');
await page.getByLabel('关联数据集').selectOption('/data/tutorial_demo_template');
await page.getByLabel('分配给').selectOption('zhang');
await page.getByLabel('审核负责人').selectOption('lily');
await page.waitForTimeout(400);
{
  const ds = await box(page.getByLabel('关联数据集'));
  const as = await box(page.getByLabel('分配给'));
  const rv = await box(page.getByLabel('审核负责人'));
  await L.annotateSteps(page, [
    { rect: [ds.x - 4, ds.y + ds.height - 40, ds.width + 8, 44], label: '1', color: '#16a34a', arrow: false },
    { rect: [as.x - 4, as.y + as.height - 40, as.width + 8, 44], label: '2', color: '#16a34a', arrow: false },
    { rect: [rv.x - 4, rv.y + rv.height - 40, rv.width + 8, 44], label: '3', color: '#16a34a', arrow: false },
  ], { caption: '选好数据集、标注人和审核人后创建' });
}
await shot('task-create-2');

// ───────── 任务详情 ─────────
await L.openTask(page, TASK);
await page.waitForTimeout(700);
{
  const enter = await page.getByRole('button', { name: '进入工作区' }).first().boundingBox();
  await L.annotateSteps(page, [{ rect: [enter.x, enter.y, enter.width, enter.height], label: '1', color: '#2563eb' }],
    { caption: '「人工标注」节点点「进入工作区」' });
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, enter.y - 380));
  await page.waitForTimeout(300);
  const e2 = await page.getByRole('button', { name: '进入工作区' }).first().boundingBox();
  await L.annotateSteps(page, [{ rect: [e2.x, e2.y, e2.width, e2.height], label: '1', color: '#2563eb' }],
    { caption: '「人工标注」节点点「进入工作区」' });
}
await shot('task-detail-1');

// ───────── 工作台：开始标注 ─────────
await L.openStudio(page, TASK, { fresh: true });
await page.waitForTimeout(800);
{
  const start = page.getByRole('button', { name: '开始标注' });
  if (await start.isVisible().catch(() => false)) {
    const b = await start.boundingBox();
    await L.annotateSteps(page, [{ rect: [b.x, b.y, b.width, b.height], label: '1' }], { caption: '先点「开始标注」' });
  } else {
    const edit = await page.getByText('编辑', { exact: true }).first().boundingBox();
    await L.annotateSteps(page, [{ rect: [edit.x - 30, edit.y - 6, 90, 28], label: '1' }], { caption: '点「编辑」打开片段编辑模式' });
  }
}
await shot('studio-1');

// ───────── 工作台：分区 ─────────
{
  const vids = [];
  for (let i = 0; i < 3; i++) vids.push(await page.locator('video').nth(i).boundingBox());
  const chart = await page.locator('text=折线图').first().boundingBox();
  const raw = await page.locator('text=原始消息').first().boundingBox();
  const track = await page.locator('[role=list]').last().boundingBox();
  const aside = await page.locator('aside').first().boundingBox();
  await L.annotateSteps(page, [
    { rect: [2, 60, 256, 880], label: '1', arrow: false, pin: [40, 80] },
    { rect: [vids[0].x, vids[0].y - 22, vids[2].x + vids[2].width - vids[0].x, vids[0].height + 22], label: '2', arrow: false, pin: [vids[0].x + 20, vids[0].y - 6] },
    { rect: [chart.x - 6, chart.y - 4, raw.x - chart.x, 290], label: '3', arrow: false, pin: [chart.x + 14, chart.y + 16] },
    { rect: [track.x - 10, track.y - 44, track.width + 20, 64], label: '4', arrow: false, pin: [track.x + 10, track.y - 26] },
    { rect: [aside.x, aside.y, aside.width, aside.height], label: '5', arrow: false, pin: [aside.x + aside.width - 30, aside.y + 30] },
  ]);
}
await shot('studio-2');

// ───────── 划片段：点未标注区 ─────────
await L.ensureEdit(page);
const track = await page.locator('[role=list]').last().boundingBox();
const total = Number(await page.locator('[role=slider]').last().getAttribute('aria-valuemax'));
{
  // 先保证整段都处于未标注状态：截取前清掉已有片段（通过界面删除）
  const items = page.locator('[role=listitem]');
  for (let k = 0; k < 6; k++) {
    const del = page.locator('button[title="删除"]').first();
    if (!(await del.isVisible().catch(() => false))) break;
    await del.click({ force: true });
    await page.waitForTimeout(300);
  }
  const t2 = await page.locator('[role=list]').last().boundingBox();
  await L.annotateSteps(page, [{ rect: [t2.x + 60, t2.y - 6, 160, t2.height + 12], label: '1' }], { caption: '在斜纹区点一下，新建一个片段' });
}
await shot('segment-1');

// ───────── 划片段：对话框 ─────────
const tb2 = await page.locator('[role=list]').last().boundingBox();
await page.mouse.click(tb2.x + 80, tb2.y + 8);
await page.waitForTimeout(800);
{
  const dlg = page.getByRole('dialog');
  if (await dlg.isVisible().catch(() => false)) {
    await dlg.locator('input').first().fill('抓取食物');
    await page.waitForTimeout(300);
    const input = await dlg.locator('input').first().boundingBox();
    const save = await dlg.getByRole('button', { name: '保存' }).boundingBox();
    await L.annotateSteps(page, [
      { rect: [input.x - 4, input.y - 4, input.width + 8, input.height + 8], label: '1', arrow: false },
      { rect: [save.x - 4, save.y - 4, save.width + 8, save.height + 8], label: '2', arrow: false },
    ], { caption: '1 给片段起名字　2 保存' });
  }
}
await shot('segment-2');
{
  const dlg = page.getByRole('dialog');
  if (await dlg.isVisible().catch(() => false)) await dlg.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(900);
}
// 拖边界
{
  const seg = await page.locator('[role=listitem]').first().boundingBox();
  const t = await page.locator('[role=list]').last().boundingBox();
  await L.annotateSteps(page, [
    { rect: [seg.x + seg.width - 10, seg.y - 6, 20, seg.height + 12], label: '1' },
  ], { caption: '拖片段右边缘调整结束帧' });
  await page.mouse.move(t.x + t.width * 0.75, t.y - 30);
}
await shot('segment-3');
console.log('done part1');
await browser.close();
