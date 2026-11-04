// 在 Studio 里点「保存修改」，把标注写回任务版本（等同标注员操作）
import * as L from './lib_lite.mjs';
const TASK = Number(process.env.TASK_ID || 10);
const { browser, ctx } = await L.launch();
const page = await ctx.newPage();
await L.login(page);
await L.openStudio(page, TASK, { fresh: true });
const btn = page.getByText('保存修改', { exact: true }).first();
console.log('保存修改 visible', await btn.isVisible().catch(() => false));
await btn.click({ force: true });
let saved = false;
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(500);
  const t = await page.locator('body').innerText();
  if (/已保存/.test(t)) { saved = true; break; }
  if (/失败/.test(t)) { console.log('failed:', t.match(/[^\n]*失败[^\n]*/)?.[0]); break; }
}
console.log('saved:', saved);
await page.waitForTimeout(1200);
await browser.close();
