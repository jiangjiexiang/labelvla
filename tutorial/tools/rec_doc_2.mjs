// 文档风录屏（二）：划片段 → 描述 → 目标框 → 提交 → 审核 → 发布
import * as L from './lib_doc.mjs';

const TASK = Number(process.env.TASK_ID || 10);
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
L.resetFrames();
await L.login(page);
await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}*,*::before,*::after{caret-color:transparent !important;user-select:none !important}' });
await L.openStudio(page, TASK, { fresh: true });
await L.addNoteStyle(page);
await L.hold(page, 1200);

const start = page.getByRole('button', { name: '开始标注' });
if (await start.isVisible().catch(() => false)) {
  const b = await start.boundingBox();
  await L.note(page, '点「开始标注」进入编辑', '1');
  await L.cursor(page, b.x + b.width / 2, b.y + b.height / 2);
  await start.click();
  await page.waitForTimeout(2000);
}
const edit = page.getByText('编辑', { exact: true }).first();
if (await edit.isVisible().catch(() => false)) {
  const b = await edit.boundingBox();
  await L.note(page, '点「编辑」打开片段编辑模式', '2');
  await L.cursor(page, b.x + b.width / 2, b.y + b.height / 2);
  await edit.click();
  await page.waitForTimeout(800);
}
await L.hideCursor(page);

const track = async () => page.locator('[role=list]').last().boundingBox();
const total = Number(await page.locator('[role=slider]').last().getAttribute('aria-valuemax'));
let tb = await track();
const frameX = (f) => tb.x + (f / total) * tb.width;

// 划第一个片段
await L.note(page, '点轨道未标注区，给动作片段起名字', '3');
await L.hold(page, 600);
await L.clickPoint(page, tb.x + 80, tb.y + 8);
await page.waitForTimeout(900);
let dlg = page.getByRole('dialog');
if (await dlg.isVisible().catch(() => false)) {
  await dlg.locator('input').first().fill('抓取食物');
  await dlg.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(1000);
}
await L.hold(page, 800);
// 拖边界到 180 帧
tb = await track();
let seg = await page.locator('[role=listitem]').first().boundingBox();
await L.note(page, '拖片段右边缘调整起止帧', '4');
await L.cursor(page, seg.x + seg.width - 2, seg.y + 8);
await L.hold(page, 400);
await page.mouse.move(seg.x + seg.width - 2, seg.y + 8);
await page.mouse.down();
const target = frameX(180);
for (let i = 1; i <= 6; i++) {
  const x = seg.x + seg.width - 2 + ((target - (seg.x + seg.width - 2)) * i) / 6;
  await page.mouse.move(x, seg.y + 8);
  await L.cursor(page, x, seg.y + 8);
  await L.snap(page, 92);
}
await page.mouse.up();
await page.waitForTimeout(700);
// 第二段
await L.note(page, '剩余部分继续划成「放到托盘」', '5');
await L.hold(page, 500);
await L.clickPoint(page, tb.x + tb.width * 0.7, tb.y + 8);
await page.waitForTimeout(900);
dlg = page.getByRole('dialog');
if (await dlg.isVisible().catch(() => false)) {
  await dlg.locator('input').first().fill('放到托盘');
  await dlg.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(1000);
}
await L.hold(page, 700);
await L.hideCursor(page);

// 选中片段、填描述
seg = await page.locator('[role=listitem]').first().boundingBox();
await L.clickPoint(page, seg.x + 12, seg.y + 8);
await page.waitForTimeout(700);
await L.note(page, '选中片段后填技能 / 对象 / 目标', '6');
await L.hold(page, 700);
for (const [label, word] of [['技能', '抓取'], ['对象', '食物'], ['目标', '托盘']]) {
  const f = L.dictInput(page, label);
  const b = await f.boundingBox();
  await L.cursor(page, b.x + 40, b.y + b.height / 2);
  await f.click();
  await page.keyboard.type(word, { delay: 45 });
  await L.snap(page, 92);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
await L.hideCursor(page);
await L.hold(page, 800);

// 画目标框
const cam = await L.cameraBox(page, 1);
const a = L.toPage(cam, 360, 330), b2 = L.toPage(cam, 470, 385);
await L.note(page, '在相机画面里拖出目标框', '7');
await L.cursor(page, a.x, a.y);
await L.hold(page, 400);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b2.x, b2.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(700);
await L.hideCursor(page);
await L.hold(page, 900);

// 保存并提交
const save = page.locator('aside button').filter({ hasText: /^保存$/ }).first();
if (await save.isVisible().catch(() => false)) {
  const sb = await save.boundingBox();
  await L.note(page, '保存标注，再提交给审核人', '8');
  await L.cursor(page, sb.x + sb.width / 2, sb.y + sb.height / 2);
  await save.click();
  await page.waitForTimeout(1500);
}
const submit = page.locator('aside button').filter({ hasText: /^提交审核$/ }).first();
if (await submit.isVisible().catch(() => false)) {
  const sb = await submit.boundingBox();
  await L.cursor(page, sb.x + sb.width / 2, sb.y + sb.height / 2);
  await submit.click();
  await page.waitForTimeout(2000);
  dlg = page.getByRole('dialog');
  if (await dlg.isVisible().catch(() => false)) {
    const ok = dlg.getByRole('button', { name: /确定|确认/ }).last();
    await ok.click();
    await page.waitForTimeout(2000);
  }
}
await L.hideCursor(page);
await L.note(page, null);
await L.hold(page, 1000);
console.log('frames', L.totalFrames());
await browser.close();
