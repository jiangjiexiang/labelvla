// 后半段步骤截图：描述、目标框、SAM、审核、发布
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
await L.openStudio(page, TASK, { fresh: true });
await page.waitForTimeout(700);
await L.ensureEdit(page);

// 选中片段 → 结构化描述
const items = page.locator('[role=listitem]');
let first = await items.first().boundingBox();
await page.mouse.click(first.x + 20, first.y + first.height / 2);
await page.waitForTimeout(800);
{
  const skill = await L.dictInput(page, '技能').boundingBox();
  const obj = await L.dictInput(page, '对象').boundingBox();
  const tgt = await L.dictInput(page, '目标').boundingBox();
  await L.annotateSteps(page, [
    { rect: [first.x, first.y - 4, first.width, first.height + 8], label: '1' },
    { rect: [skill.x - 4, skill.y - 4, skill.width + 8, skill.height + 8], label: '2', arrow: false },
    { rect: [obj.x - 4, obj.y - 4, obj.width + 8, obj.height + 8], label: '3', arrow: false },
    { rect: [tgt.x - 4, tgt.y - 4, tgt.width + 8, tgt.height + 8], label: '4', arrow: false },
  ], { caption: '1 选中片段　2–4 填技能 / 对象 / 目标' });
}
await shot('describe-1');
await L.clearSteps(page);
for (const [label, word] of [['技能', '抓取'], ['对象', '食物'], ['目标', '托盘']]) {
  const f = L.dictInput(page, label);
  await f.click(); await page.keyboard.type(word, { delay: 30 }); await page.keyboard.press('Enter');
  await page.waitForTimeout(250); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
}
{
  const skill = await L.dictInput(page, '技能').boundingBox();
  const tgt = await L.dictInput(page, '目标').boundingBox();
  await L.annotateSteps(page, [{ rect: [skill.x - 4, skill.y - 4, tgt.width + 8, tgt.y + tgt.height - skill.y + 8], label: '1', color: '#16a34a', arrow: false }],
    { caption: '填完后自动拼成描述句' });
}
await shot('describe-2');

// 目标框
{
  const cam = await L.cameraBox(page, 1);
  const a = L.toPage(cam, 360, 330), b = L.toPage(cam, 470, 385);
  await L.annotateSteps(page, [{ rect: [a.x - 6, a.y - 6, b.x - a.x + 12, b.y - a.y + 12], label: '1' }], { caption: '在相机画面里按住拖动，画出目标框' });
  // 画已有的框：真画一次再截
  await L.clearSteps(page);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(700);
  const fi = await page.locator('aside').innerText();
  const boxRow = await page.locator('aside').getByText('1024×768').first().boundingBox().catch(() => null);
  const cam2 = await L.cameraBox(page, 1);
  await L.annotateSteps(page, [
    { rect: [L.toPage(cam2, 360, 330).x - 6, L.toPage(cam2, 360, 330).y - 6, 40, 30], label: '1', arrow: false },
  ]);
  await L.clearSteps(page);
  await L.annotateSteps(page, [{ rect: [L.toPage(cam2, 360, 330).x - 6, L.toPage(cam2, 360, 330).y - 6, L.toPage(cam2, 470, 385).x - L.toPage(cam2, 360, 330).x + 12, L.toPage(cam2, 470, 385).y - L.toPage(cam2, 360, 330).y + 12], label: '1' }],
    { caption: '画好的框会出现在右侧「目标框」列表里' });
}
await shot('bbox-1');

// SAM 入口 → 就绪 → 点选
{
  const sam = page.getByRole('button', { name: 'SAM 点选分割' });
  if (await sam.isVisible().catch(() => false)) {
    const b = await sam.boundingBox();
    await L.annotateSteps(page, [{ rect: [b.x - 4, b.y - 4, b.width + 8, b.height + 8], label: '1' }], { caption: '选中片段后才有 SAM 入口' });
    await shot('sam-1');
    await sam.click();
    for (let i = 0; i < 60; i++) { await page.waitForTimeout(800); if (/SAM 就绪/.test(await page.locator('aside').innerText())) break; }
    await page.waitForTimeout(500);
    const sel = await page.locator('aside select').first().boundingBox().catch(() => null);
    const prop = await page.getByRole('button', { name: /传播跟踪/ }).boundingBox().catch(() => null);
    await L.annotateSteps(page, [
      ...(sel ? [{ rect: [sel.x - 4, sel.y - 4, sel.width + 8, sel.height + 8], label: '1', arrow: false }] : []),
      ...(prop ? [{ rect: [prop.x - 4, prop.y - 4, prop.width + 8, prop.height + 8], label: '2', arrow: false }] : []),
    ], { caption: '1 选择相机　2 先点选目标，再点传播跟踪' });
    await shot('sam-2');
    const cam = await L.cameraBox(page, 1);
    const pt = L.toPage(cam, 422, 333);
    await page.mouse.move(pt.x, pt.y); await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(3500);
    await L.dismissErrorDialog(page).catch(() => {});
    await page.waitForTimeout(1200);
    await L.annotateSteps(page, [{ rect: [pt.x - 14, pt.y - 14, 28, 28], label: '1', color: '#16a34a' }], { caption: '点中后出现蓝色轮廓，再点「传播跟踪」' });
    await shot('sam-3');
  }
}
console.log('done part2');
await browser.close();
