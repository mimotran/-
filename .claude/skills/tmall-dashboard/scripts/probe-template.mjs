/**
 * Playwright 交互探针模板。
 *
 * 看板的交互（悬停、点击、下拉、区间切换、动效）没有单元测试，靠起一个真页面
 * 去点。改完交互照着这个改选择器和断言，跑一遍再提交。
 *
 * 原则：**断言具体的值**，不是「元素存在」。
 *   ✓ opacity=0.34、色带中心与柱心相差 0.1px、tooltip 日期 = 07-18
 *   ✗ 「.col-band 存在」——16px 的错位它抓不到
 *
 * 用法：
 *   cp preview/dashboard.html /tmp/preview.html
 *   cd /tmp && node probe-template.mjs
 *   CHROME_PATH=/path/to/chrome node probe-template.mjs   # 浏览器装在别处时
 */
import { chromium } from 'playwright-core';

const launch = {
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox'],
};

const b = await chromium.launch(launch);

/** 每个用例开一个干净的页面：状态（选中的指标、区间）会互相污染 */
async function open({ dark = false, reduce = false, width = 1500 } = {}) {
  const p = await b.newPage({
    viewport: { width, height: 1100 },
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + process.cwd() + '/preview.html', { waitUntil: 'load' });
  await p.waitForTimeout(800);   // 等入场动效落定，否则量到的是动画中间态
  return { p, errs };
}

/** 切板块。板块靠 display 显隐，隐藏时 boundingBox 是空的，必须先切 */
async function section(p, id) {
  await p.click('#tab-' + id);
  await p.waitForTimeout(700);
}

// ---------------------------------------------------------------------------
// 用例 1：悬停高亮 —— 断言的是具体的 opacity 和位置，不是「有没有类名」
// ---------------------------------------------------------------------------
{
  const { p, errs } = await open();
  await section(p, 'sec-store');

  const svg = await p.$('#store-chart svg');
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();

  let worst = 0;
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    await p.mouse.move(box.x + box.width * f, box.y + box.height * 0.6);
    await p.waitForTimeout(150);
    const d = await svg.evaluate((el) => {
      const band = el.querySelector('.col-band');
      const on = el.querySelector('[data-col].on');
      if (!band || !on || band.style.opacity !== '1') return null;
      const a = band.getBoundingClientRect(), o = on.getBoundingClientRect();
      return Math.abs((a.x + a.width / 2) - (o.x + o.width / 2));
    });
    if (d !== null) worst = Math.max(worst, d);
  }
  console.log(`色带与柱心最大偏移 ${worst.toFixed(2)}px`, worst < 1 ? '✓' : '✗ 应当 <1px');
  console.log('errors:', errs.length ? errs : 'none');
  await p.close();
}

// ---------------------------------------------------------------------------
// 用例 2：控件改了状态之后，图和文案要跟着变（而不是只有按钮高亮变了）
// ---------------------------------------------------------------------------
{
  const { p, errs } = await open();
  await section(p, 'sec-store');

  const read = () => p.evaluate(() => ({
    副标: document.getElementById('store-trend-sub')?.textContent.slice(0, 60),
    图例: [...document.querySelectorAll('#store-legend .legend-item')].map((e) => e.textContent.trim()),
    柱数: document.querySelectorAll('#store-chart svg rect[data-col]').length,
    线数: document.querySelectorAll('#store-chart svg path[stroke]:not([stroke="none"])').length,
  }));

  console.log('默认  ', await read());
  await p.click('#store-range button:nth-child(1)');     // 近 7 天
  await p.waitForTimeout(500);
  console.log('近7天 ', await read());
  console.log('errors:', errs.length ? errs : 'none');
  await p.close();
}

// ---------------------------------------------------------------------------
// 用例 3：深色 + 减少动态。这两个组合最容易被忘，也最容易出问题
// ---------------------------------------------------------------------------
for (const opts of [{ dark: true }, { reduce: true }]) {
  const { p, errs } = await open(opts);
  await section(p, 'sec-product');
  const r = await p.evaluate(() => ({
    动画中的元素: document.getAnimations().filter((a) => a.playState === 'running').length,
    图表数: document.querySelectorAll('.chart svg').length,
  }));
  console.log(JSON.stringify(opts), r, 'errors:', errs.length ? errs : 'none');
  await p.close();
}

// ---------------------------------------------------------------------------
// 用例 4：窄屏不能横向溢出（表格要在自己的容器里滚，不能撑开 body）
// ---------------------------------------------------------------------------
for (const width of [1500, 1080, 760, 430]) {
  const { p, errs } = await open({ width });
  await section(p, 'sec-store');
  const r = await p.evaluate(() => ({
    页宽: document.documentElement.scrollWidth,
    视宽: document.documentElement.clientWidth,
  }));
  const ok = r.页宽 <= r.视宽 + 1;
  console.log(`${width}px`, JSON.stringify(r), ok ? '✓' : '✗ 横向溢出');
  if (errs.length) console.log('  errors:', errs);
  await p.close();
}

// 截图：数值对不代表好看。深浅两色各来一张，自己看一眼
{
  const { p } = await open();
  await section(p, 'sec-store');
  await p.screenshot({ path: 'probe-light.png', fullPage: false });
  await p.close();
}

await b.close();
