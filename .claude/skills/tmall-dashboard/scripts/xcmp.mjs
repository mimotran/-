/**
 * 数值对账：lib 算一遍，浏览器里再算一遍，逐格比。
 *
 * 页面为了支持任意自定义区间，在浏览器里重写了一份聚合逻辑 —— 重写就有走样的
 * 风险。这个脚本把 lib 的结果（ref.json）和页面现算的结果摆在一起比，1600+ 项
 * 逐个对，差一个就退出码 1。
 *
 * 用法（在一个临时目录里跑，需要 playwright-core）：
 *   npx tsx scripts/xcheck.ts > ref.json
 *   cp preview/dashboard.html ./preview.html
 *   node xcmp.mjs
 *
 * 浏览器路径：默认用 playwright 自己装的；装在别处时设 CHROME_PATH 环境变量。
 */
import { readFileSync } from 'fs';
import { chromium } from 'playwright-core';
const REF = JSON.parse(readFileSync('ref.json', 'utf8'));
const b = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox'],
});
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/preview.html', { waitUntil: 'load' });
await p.waitForTimeout(900);
if (errs.length) { console.log('页面报错:', errs); process.exit(1); }

let bad = 0;
/**
 * 数值比较。
 *
 * 派生比率（ROI / CVR / 各种占比）两边的算法一致，但预览页拿的是**导出时取过整**
 * 的分子分母，所以末位必然有微小漂移 —— 8.76 vs 8.760045。这是导出量化的必然结果，
 * 不是逻辑走样，给它们一个相对容差；可加的量（金额、人数、点击）仍然要求精确。
 */
const RATIO_KEYS = new Set([
  'roi', 'roiInsite', 'roiOffsite', 'cvr', 'ctr', 'costShare',
  'conversionRate', 'refundRate', 'adCostRate', 'uvShare', 'gmvShare',
  'searchUvValue', 'searchGmvShare', 'paidUvShare', 'aov',
]);
const near = (a, c, key) => a === null || c === null ? a === c
  : Math.abs(a - c) <= Math.max(1e-6, Math.abs(a) * (RATIO_KEYS.has(key) ? 1e-4 : 1e-8));

// 1) 聚合
const gotAgg = await p.evaluate((rs) => rs.map(r => {
  const [from, to] = r.range.split('~'); const a = aggregate(from, to);
  return { range: r.range, gmv: Math.round(a.gmv), deviceSales: a.deviceSales,
    refundRate: +a.refundRate.toFixed(6), adCostRate: +a.adCostRate.toFixed(6),
    aov: +a.aov.toFixed(4), roi: +a.roi.toFixed(4), conversionRate: +a.conversionRate.toFixed(6),
    searchUvValue: +a.searchUvValue.toFixed(4), searchBuyers: a.searchBuyers, searchGmvShare: +a.searchGmvShare.toFixed(6),
    paidUvShare: +a.paidUvShare.toFixed(6), paidUv: a.paidUv, searchGmv: Math.round(a.searchGmv) };
}), REF.aggregates);
for (let i = 0; i < REF.aggregates.length; i++)
  for (const k of Object.keys(REF.aggregates[i])) {
    if (k === 'range') continue;
    if (!near(REF.aggregates[i][k], gotAgg[i][k], k)) {
      console.log(`✗ 聚合 ${REF.aggregates[i].range} ${k}: lib=${REF.aggregates[i][k]} 预览=${gotAgg[i][k]}`); bad++;
    }
  }

// 2) 目标达成自定义区间
const gotGoal = await p.evaluate((rs) => rs.map(r => {
  const [from, to] = r.range.split('~');
  const g = buildCustomGoal({ from, to });
  return { range: r.range, timeProgress: +g.timeProgress.toFixed(6),
    rows: g.groups.flatMap(x => x.rows).map(row => ({ key: row.key,
      target: row.target === null ? null : +row.target.toFixed(4),
      actual: row.actual === null ? null : +row.actual.toFixed(4),
      attainment: row.attainment === null ? null : +row.attainment.toFixed(6),
      ppDiff: row.ppDiff === null ? null : +row.ppDiff.toFixed(6),
      good: row.good, rateGood: row.rateGood })) };
}), REF.goals);

for (let i = 0; i < REF.goals.length; i++) {
  const a = REF.goals[i], c = gotGoal[i];
  if (!near(a.timeProgress, c.timeProgress, 'timeProgress')) { console.log(`✗ ${a.range} 计划进度: lib=${a.timeProgress} 预览=${c.timeProgress}`); bad++; }
  for (let j = 0; j < a.rows.length; j++) {
    for (const k of Object.keys(a.rows[j])) {
      if (k === 'key') continue;
      const av = a.rows[j][k], cv = c.rows[j][k];
      const ok = typeof av === 'boolean' || av === null ? av === cv : near(av, cv, k);
      if (!ok) { console.log(`✗ ${a.range} ${a.rows[j].key}.${k}: lib=${av} 预览=${cv}`); bad++; }
    }
  }
}
// 3) 趋势序列
const gotTrend = await p.evaluate((rs) => rs.map(r => {
  const [from, to] = r.range.split('~');
  return { range: r.range, points: trendRange(from, to).map(t => ({
    date: t.date, gmv: Math.round(t.gmv), deviceSales: t.deviceSales,
    refundRate: +t.refundRate.toFixed(8), uv: t.uv,
    roiInsite: +t.roiInsite.toFixed(6), roiOffsite: +t.roiOffsite.toFixed(6),
    conversionRate: +t.conversionRate.toFixed(8),
    adCostInsite: Math.round(t.adCostInsite), adGmvOffsite: Math.round(t.adGmvOffsite) })) };
}), REF.trends);

let trendCells = 0;
for (let i = 0; i < REF.trends.length; i++) {
  const a = REF.trends[i], c = gotTrend[i];
  if (a.points.length !== c.points.length) { console.log(`✗ ${a.range} 点数: lib=${a.points.length} 预览=${c.points.length}`); bad++; continue; }
  for (let j = 0; j < a.points.length; j++)
    for (const k of Object.keys(a.points[j])) {
      trendCells++;
      const av = a.points[j][k], cv = c.points[j][k];
      const ok = k === 'date' ? av === cv : near(av, cv, k);
      if (!ok) { console.log(`✗ ${a.range} ${a.points[j].date}.${k}: lib=${av} 预览=${cv}`); bad++; }
    }
}

// 4) 分触点 / 分渠道拆解
const gotBd = await p.evaluate((cs) => cs.map(c => {
  const [scope, span] = c.key.split(':');
  const [from, to] = span.split('~');
  const cf = c.cf, ct = c.ct;
  return { key: c.key, rows: adBreakdown(scope, { from, to }, { from: cf, to: ct }).map(r => ({
    channel: r.channel, cost: r.cost, gmv: r.gmv, orders: r.orders,
    impressions: r.impressions, clicks: r.clicks,
    roi: +r.roi.toFixed(8), cvr: +r.cvr.toFixed(8), ctr: +r.ctr.toFixed(8),
    costShare: +r.costShare.toFixed(8), prevCost: r.prevCost })) };
}), REF.breakdowns.map((b, i) => ({ key: b.key, cf: [['2026-07-01'],['2026-05-02'],['2025-01-01']][i][0], ct: [['2026-07-09'],['2026-05-31'],['2025-08-09']][i][0] })));

let bdCells = 0;
for (let i = 0; i < REF.breakdowns.length; i++) {
  const a = REF.breakdowns[i], c = gotBd[i];
  if (a.rows.length !== c.rows.length) { console.log(`✗ ${a.key} 行数: lib=${a.rows.length} 预览=${c.rows.length}`); bad++; continue; }
  for (let j = 0; j < a.rows.length; j++) {
    if (a.rows[j].channel !== c.rows[j].channel) { console.log(`✗ ${a.key} 第${j}行顺序: lib=${a.rows[j].channel} 预览=${c.rows[j].channel}`); bad++; continue; }
    for (const k of Object.keys(a.rows[j])) {
      if (k === 'channel') continue;
      bdCells++;
      if (!near(a.rows[j][k], c.rows[j][k], k)) { console.log(`✗ ${a.key} ${a.rows[j].channel}.${k}: lib=${a.rows[j][k]} 预览=${c.rows[j][k]}`); bad++; }
    }
  }
}

// 5) 分产品线拆解
const gotProd = await p.evaluate((cs) => cs.map(c => {
  const [from, to] = c.range.split('~');
  const g = prodRollup(from, to, 'gmv'), q = prodRollup(from, to, 'quantity');
  return { range: c.range, lines: c.lines.map(l => ({ line: l.line, gmv: Math.round(g[l.line] || 0), quantity: q[l.line] || 0 })) };
}), REF.products);

let prodCells = 0;
for (let i = 0; i < REF.products.length; i++) {
  const a = REF.products[i], c = gotProd[i];
  const [f, t] = a.range.split('~');
  const days = Math.round((new Date(t) - new Date(f)) / 86400000) + 1;
  if (a.lines.length !== c.lines.length) { console.log(`\u2717 ${a.range} 产品线数: lib=${a.lines.length} 预览=${c.lines.length}`); bad++; continue; }
  for (let j = 0; j < a.lines.length; j++) {
    if (a.lines[j].line !== c.lines[j].line) { console.log(`\u2717 ${a.range} 第${j}条线顺序: lib=${a.lines[j].line} 预览=${c.lines[j].line}`); bad++; continue; }
    // GMV 的容差 = 天数 × 0.5：导出时每天每条线取整一次，这个漂移是设计内的；
    // 真正要抓的是少算/多算了整天，那种误差远大于半元一天。销量本来就是整数，必须完全相等。
    prodCells += 2;
    if (Math.abs(a.lines[j].gmv - c.lines[j].gmv) > days * 0.5 + 1) {
      console.log(`\u2717 ${a.range} ${a.lines[j].line}.gmv: lib=${a.lines[j].gmv} 预览=${c.lines[j].gmv}（容差 ${days * 0.5 + 1}）`); bad++;
    }
    if (a.lines[j].quantity !== c.lines[j].quantity) {
      console.log(`\u2717 ${a.range} ${a.lines[j].line}.quantity: lib=${a.lines[j].quantity} 预览=${c.lines[j].quantity}`); bad++;
    }
  }
}

// 6) 流量来源
const gotTc = await p.evaluate((cs) => cs.map(c => {
  const [from, to] = c.range.split('~');
  const g = tcRollup(from, to);
  const totalUv = g.totalUv, totalGmv = g.totalGmv;
  return { range: c.range, rows: [...g.rows].sort((a, b) => b.uv - a.uv).map(x => ({
    channel: x.channel, uv: x.uv, buyers: x.buyers, gmv: Math.round(x.gmv),
    conversionRate: +x.conversionRate.toFixed(8),
    uvShare: +(totalUv > 0 ? x.uv / totalUv : 0).toFixed(8),
    gmvShare: +(totalGmv > 0 ? x.gmv / totalGmv : 0).toFixed(8) })) };
}), REF.trafficChannels);

let kwCells = 0;
for (let i = 0; i < REF.trafficChannels.length; i++) {
  const a = REF.trafficChannels[i], c = gotTc[i];
  if (a.rows.length !== c.rows.length) { console.log(`\u2717 ${a.range} 来源数: lib=${a.rows.length} 预览=${c.rows.length}`); bad++; continue; }
  for (let j = 0; j < a.rows.length; j++) {
    if (a.rows[j].channel !== c.rows[j].channel) { console.log(`\u2717 ${a.range} 第${j}行顺序: lib=${a.rows[j].channel} 预览=${c.rows[j].channel}`); bad++; continue; }
    for (const k of ['uv','buyers','gmv','conversionRate','uvShare','gmvShare']) {
      kwCells++;
      if (!near(a.rows[j][k], c.rows[j][k], k)) { console.log(`\u2717 ${a.range} ${a.rows[j].channel}.${k}: lib=${a.rows[j][k]} 预览=${c.rows[j][k]}`); bad++; }
    }
  }
}

// 7) 搜索词排行：页面从 CSR 稀疏数组解码 + 排名，lib 侧直接逐行求和，两条路独立
const gotKw = await p.evaluate((cs) => cs.map(c => {
  const [from, to] = c.range.split('~');
  const [lo, hi] = rangeSlice(from, to);
  const { rows, hasPrev } = twRank(lo, hi);
  const ranked = withRankDelta(rows, hasPrev);
  return { range: c.range, base: twBase(lo, hi), matched: ranked.length,
    top: ranked.slice(0, 25).map(r => ({ rank: r.rank, term: r.term, uv: r.uv })) };
}), REF.searchTerms);

let twCells = 0;
for (let i = 0; i < REF.searchTerms.length; i++) {
  const a = REF.searchTerms[i], c = gotKw[i];
  for (const k of ['base', 'matched']) {
    twCells++;
    if (a[k] !== c[k]) { console.log(`✗ 搜索词 ${a.range} ${k}: lib=${a[k]} 预览=${c[k]}`); bad++; }
  }
  for (let j = 0; j < a.top.length; j++) {
    twCells += 2;
    if (a.top[j].term !== c.top[j]?.term) {
      console.log(`✗ 搜索词 ${a.range} 第${j + 1}名: lib=${a.top[j].term} 预览=${c.top[j]?.term}`); bad++; continue;
    }
    if (a.top[j].uv !== c.top[j].uv) {
      console.log(`✗ 搜索词 ${a.range} ${a.top[j].term} 访客: lib=${a.top[j].uv} 预览=${c.top[j].uv}`); bad++;
    }
  }
}

// 8) 投放汇总块
const gotAt = await p.evaluate((cs) => cs.map(c => {
  const [scope, rng] = c.key.split(':');
  const [from, to] = rng.split('~');
  const a = adTotalAgg(scope, from, to);
  return { key: c.key,
    cost: Math.round(a.cost), gmv: Math.round(a.gmv), orders: Math.round(a.orders),
    impressions: Math.round(a.impressions), clicks: Math.round(a.clicks), shopGmv: Math.round(a.shopGmv),
    roi: +a.roi.toFixed(6), cvr: +a.cvr.toFixed(8), cpm: +a.cpm.toFixed(6), cpc: +a.cpc.toFixed(6) };
}), REF.adTotals);

let atCells = 0;
for (let i = 0; i < REF.adTotals.length; i++) {
  const a = REF.adTotals[i], c = gotAt[i];
  for (const k of Object.keys(a)) {
    if (k === 'key') continue;
    atCells++;
    if (!near(a[k], c[k], k)) { console.log(`✗ 投放汇总 ${a.key} ${k}: lib=${a[k]} 预览=${c[k]}`); bad++; }
  }
}

// 9) 分产品明细
const gotPd = await p.evaluate((cs) => cs.map(c => {
  const [from, to] = c.range.split('~');
  const g = (mk) => prodRollup(from, to, mk);
  const gmv = g('gmv'), qty = g('quantity'), buy = g('buyers'), uv = g('uv'), rf = g('refund');
  const lines = ['pro', 'pins', 'note'];
  const totalQty = lines.reduce((s, k) => s + qty[k], 0);
  const shape = (line, G, Q, B, U, R) => ({ line,
    gmv: Math.round(G), quantity: Math.round(Q), buyers: Math.round(B), uv: Math.round(U),
    cvr: +div(B, U).toFixed(8), price: +div(G, Q).toFixed(6),
    refundRate: +div(R, G).toFixed(8), qtyShare: +div(Q, totalQty).toFixed(8) });
  const sum = (o) => lines.reduce((s, k) => s + o[k], 0);
  return { range: c.range, rows: [
    ...lines.map(k => shape(k, gmv[k], qty[k], buy[k], uv[k], rf[k])),
    shape('汇总', sum(gmv), totalQty, sum(buy), sum(uv), sum(rf)),
  ] };
}), REF.productDetail);

let pdCells = 0;
for (let i = 0; i < REF.productDetail.length; i++) {
  const a = REF.productDetail[i], c = gotPd[i];
  for (let j = 0; j < a.rows.length; j++) {
    for (const k of Object.keys(a.rows[j])) {
      if (k === 'line') continue;
      pdCells++;
      if (!near(a.rows[j][k], c.rows[j][k], k)) {
        console.log(`✗ 分产品明细 ${a.range} ${a.rows[j].line}.${k}: lib=${a.rows[j][k]} 预览=${c.rows[j][k]}`); bad++;
      }
    }
  }
}

const cells = pdCells + atCells + twCells + kwCells + prodCells + bdCells + trendCells + REF.aggregates.length * 13 + REF.goals.reduce((s, g) => s + 1 + g.rows.length * 6, 0);
console.log(bad === 0 ? `✓ ${cells} 项数值全部与 lib 一致（聚合 / 目标达成 / 趋势 / 投放拆解 / 产品拆解 / 流量来源 / 搜索词 / 投放汇总 / 分产品明细）` : `✗ ${bad} 处不一致`);
await b.close();
process.exit(bad ? 1 : 0);
