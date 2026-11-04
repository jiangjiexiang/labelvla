import * as L from '/home/robam/labelvla-docker/tutorial/tools/lib.mjs';
import fs from 'fs';
const OUT = '/home/robam/labelvla-docker/tutorial/images/steps';
fs.mkdirSync(OUT, { recursive: true });
process.env.SHOT_DIR = OUT;
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
await page.addStyleTag({ content: '*,*::before,*::after{scroll-behavior:auto !important}' });
const shot = async (n) => { await L.shot(page, n); await L.clearSteps(page); };
await L.login(page);
// 版本管理
await page.goto(L.API + '/?page=versions', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
{
  const rows = page.locator('tbody tr', { hasText: 'tutorial_demo_template' });
  const n = await rows.count();
  const items = [];
  for (let i = 0; i < Math.min(n, 2); i++) {
    const b = await rows.nth(i).boundingBox();
    items.push({ rect: [b.x, b.y, b.width, b.height], label: String(i + 1), arrow: false });
  }
  await L.annotateSteps(page, items, { caption: '每次发布都是一个独立版本，可下载完整数据包' });
}
await shot('versions-1');
// 常见问题页要用的：任务失败的样子（程序质检未通过）
console.log('done part4');
await browser.close();
