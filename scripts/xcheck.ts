/**
 * 交叉校验：预览页里手写的 JS 聚合，必须和 lib 的 aggregateRange 完全一致。
 * 预览页为了支持任意自定义区间，在浏览器里重写了一份聚合逻辑 ——
 * 重写就有走样的风险，这个脚本把两边的结果摆在一起比。
 */
import { getSnapshot } from '../lib/data/source';
import { adBreakdown, aggregateRange, buildGoals, buildTrend, productBreakdown, trafficChannelBreakdown } from '../lib/metrics';
import { loadLocalEnv } from './env';

loadLocalEnv();

const RANGES = [
  { from: '2026-06-01', to: '2026-06-30' },
  { from: '2026-05-02', to: '2026-05-31' },
  { from: '2025-11-01', to: '2025-11-30' },
  { from: '2026-08-06', to: '2026-08-06' },
];

async function main() {
  const snap = await getSnapshot();
  const out = RANGES.map((r) => {
    const a = aggregateRange(snap.daily, r);
    return {
      range: `${r.from}~${r.to}`,
      gmv: Math.round(a.gmv),
      deviceSales: a.deviceSales,
      refundRate: +a.refundRate.toFixed(6),
      adCostRate: +a.adCostRate.toFixed(6),
      aov: +a.aov.toFixed(4),
      roi: +a.roi.toFixed(4),
      conversionRate: +a.conversionRate.toFixed(6),
      searchUvValue: +a.searchUvValue.toFixed(4),
      searchBuyers: a.searchBuyers,
      searchGmvShare: +a.searchGmvShare.toFixed(6),
      paidUvShare: +a.paidUvShare.toFixed(6),
      paidUv: a.paidUv,
      searchGmv: Math.round(a.searchGmv),
    };
  });
  // 目标达成的自定义区间：预览页也重写了一份，同样要逐项对上
  const latest = snap.daily[snap.daily.length - 1].date;
  const goalRanges = [
    { from: '2026-07-01', to: '2026-07-31' },
    { from: '2026-06-15', to: '2026-08-06' },
    { from: '2025-10-01', to: '2025-12-31' },
  ];
  const goals = goalRanges.map((r) => {
    const period = buildGoals(snap.daily, snap.targets, latest, r, snap.monthlyActuals).find((p) => p.key === 'custom');
    return {
      range: `${r.from}~${r.to}`,
      timeProgress: +(period?.timeProgress ?? 0).toFixed(6),
      rows: (period?.groups ?? []).flatMap((g) => g.rows).map((row) => ({
        key: row.key,
        target: row.target === null ? null : +row.target.toFixed(4),
        actual: row.actual === null ? null : +row.actual.toFixed(4),
        attainment: row.attainment === null ? null : +row.attainment.toFixed(6),
        ppDiff: row.ppDiff === null ? null : +row.ppDiff.toFixed(6),
        good: row.good,
        rateGood: row.rateGood,
      })),
    };
  });

  // 趋势序列：预览页要支持任意区间，也重写了一份逐日派生
  const trendRanges = [
    { from: '2026-07-08', to: '2026-08-06' },
    { from: '2026-06-01', to: '2026-06-30' },
  ];
  const trends = trendRanges.map((r) => ({
    range: `${r.from}~${r.to}`,
    points: buildTrend(snap.daily, r).map((t) => ({
      date: t.date,
      gmv: Math.round(t.gmv),
      deviceSales: t.deviceSales,
      refundRate: +t.refundRate.toFixed(8),
      uv: t.uv,
      roiInsite: +t.roiInsite.toFixed(6),
      roiOffsite: +t.roiOffsite.toFixed(6),
      conversionRate: +t.conversionRate.toFixed(8),
      adCostInsite: Math.round(t.adCostInsite),
      adGmvOffsite: Math.round(t.adGmvOffsite),
    })),
  }));

  // 分触点 / 分渠道拆解：预览页要支持任意区间，也重写了一份
  const bdCases = [
    { scope: 'insite' as const, from: '2026-08-01', to: '2026-08-09', cf: '2026-07-01', ct: '2026-07-09' },
    { scope: 'insite' as const, from: '2026-06-01', to: '2026-06-30', cf: '2026-05-02', ct: '2026-05-31' },
    { scope: 'offsite' as const, from: '2026-01-01', to: '2026-08-09', cf: '2025-01-01', ct: '2025-08-09' },
  ];
  const breakdowns = bdCases.map((c) => ({
    key: `${c.scope}:${c.from}~${c.to}`,
    rows: adBreakdown(snap.ads, c.scope, { from: c.from, to: c.to }, { from: c.cf, to: c.ct }).map((r) => ({
      channel: r.channel,
      cost: r.cost, gmv: r.gmv, orders: r.orders,
      impressions: r.impressions, clicks: r.clicks,
      roi: +r.roi.toFixed(8), cvr: +r.cvr.toFixed(8), ctr: +r.ctr.toFixed(8),
      costShare: +r.costShare.toFixed(8),
      prevCost: r.prevCost,
    })),
  }));

  /**
   * 分产品线拆解：产品块的三张图（每日堆叠 / 月度对比 / 年累计环形）都从
   * 导出的 productDaily 列在浏览器里重新求和，同样要和 productBreakdown 对上。
   * 特意挑了跨月、单日、全年三种区间 —— 边界那天最容易被切掉。
   */
  const prodRanges = [
    { from: '2026-08-01', to: '2026-08-09' },
    { from: '2026-06-01', to: '2026-06-30' },
    { from: '2026-01-01', to: '2026-08-09' },
    { from: '2025-12-31', to: '2025-12-31' },
  ];
  const products = prodRanges.map((r) => ({
    range: `${r.from}~${r.to}`,
    lines: productBreakdown(snap.products, r, null).lines.map((l) => ({
      line: l.line,
      gmv: Math.round(l.gmv),
      quantity: l.quantity,
    })),
  }));

  /**
   * 分产品明细表：预览页从导出的列数组按区间求和再算比率，这里直接对
   * snapshot.products 逐行加。比率的分子分母各自加完再除，两边必须一致 ——
   * 页面上但凡把三行比率平均一下当汇总，这里就会报出来。
   */
  const productDetail = prodRanges.map((r) => {
    const lines = ['pro', 'pins', 'note'];
    const rows = lines.map((line) => {
      const rs = snap.products.filter((x) => x.line === line && x.date >= r.from && x.date <= r.to);
      const sum = (k: 'gmv' | 'quantity' | 'buyers' | 'uv' | 'refund') => rs.reduce((a, x) => a + x[k], 0);
      return { line, gmv: sum('gmv'), quantity: sum('quantity'), buyers: sum('buyers'), uv: sum('uv'), refund: sum('refund') };
    });
    const tot = (k: 'gmv' | 'quantity' | 'buyers' | 'uv' | 'refund') => rows.reduce((a, x) => a + x[k], 0);
    const totalQty = tot('quantity');
    const shape = (x: { line: string; gmv: number; quantity: number; buyers: number; uv: number; refund: number }) => ({
      line: x.line,
      gmv: Math.round(x.gmv), quantity: Math.round(x.quantity),
      buyers: Math.round(x.buyers), uv: Math.round(x.uv),
      cvr: +(x.uv === 0 ? 0 : x.buyers / x.uv).toFixed(8),
      price: +(x.quantity === 0 ? 0 : x.gmv / x.quantity).toFixed(6),
      refundRate: +(x.gmv === 0 ? 0 : x.refund / x.gmv).toFixed(8),
      qtyShare: +(totalQty === 0 ? 0 : x.quantity / totalQty).toFixed(8),
    });
    return {
      range: `${r.from}~${r.to}`,
      rows: [
        ...rows.map(shape),
        shape({ line: '汇总', gmv: tot('gmv'), quantity: totalQty, buyers: tot('buyers'), uv: tot('uv'), refund: tot('refund') }),
      ],
    };
  });

  /** 流量来源拆解：预览页从 trafficDaily 重新求和，要和 trafficChannelBreakdown 对上 */
  const tcRanges = [
    { from: '2026-08-09', to: '2026-08-09' },
    { from: '2026-08-01', to: '2026-08-09' },
    { from: '2026-01-01', to: '2026-08-09' },
    { from: '2026-05-01', to: '2026-05-31' },
  ];
  const trafficChannels = tcRanges.map((r) => ({
    range: `${r.from}~${r.to}`,
    rows: trafficChannelBreakdown(snap.trafficChannels, r, null).map((x) => ({
      channel: x.channel,
      uv: x.uv,
      buyers: x.buyers,
      gmv: Math.round(x.gmv),
      conversionRate: +x.conversionRate.toFixed(8),
      uvShare: +x.uvShare.toFixed(8),
      gmvShare: +x.gmvShare.toFixed(8),
    })),
  }));

  /**
   * 搜索词排行：预览页拿的是 CSR 压缩过的稀疏数组，在浏览器里重新解码 + 排名。
   * 这里直接对 snapshot.searchTerms 逐行求和 —— 两条路完全独立，编码写错
   * （偏移串位、日期没对齐）会立刻暴露成排名或访客数不一致。
   */
  const kwRanges = [
    { from: '2026-07-12', to: '2026-08-10' },
    { from: '2026-08-04', to: '2026-08-10' },
    { from: '2026-01-01', to: '2026-08-10' },
    { from: '2026-03-17', to: '2026-04-02' },
  ];
  const searchTerms = kwRanges.map((r) => {
    const inRange = snap.searchTerms.filter((x) => x.date >= r.from && x.date <= r.to);
    const byTerm = new Map<string, number>();
    for (const x of inRange) byTerm.set(x.term, (byTerm.get(x.term) ?? 0) + x.uv);
    const ranked = [...byTerm.entries()]
      .filter(([, uv]) => uv > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      range: `${r.from}~${r.to}`,
      base: Math.round(inRange.reduce((sum, x) => sum + x.uv, 0)),
      matched: ranked.length,
      top: ranked.slice(0, 25).map(([term, uv], i) => ({ rank: i + 1, term, uv: Math.round(uv) })),
    };
  });

  /**
   * 投放汇总块：页面从导出的列数组里按区间求和，这里直接对 snapshot.adTotals
   * 逐行加。两条路独立 —— 导出时列没对齐日期、或聚合把比率也加了起来，都会露馅。
   */
  const adTotalRanges = [
    { from: '2026-08-10', to: '2026-08-10' },
    { from: '2026-07-01', to: '2026-07-31' },
    { from: '2026-01-01', to: '2026-08-10' },
    { from: '2026-05-14', to: '2026-06-03' },
  ];
  const adTotals = adTotalRanges.flatMap((r) =>
    (['insite', 'offsite'] as const).map((scope) => {
      const rows = snap.adTotals.filter((x) => x.scope === scope && x.date >= r.from && x.date <= r.to);
      const sum = (k: 'cost' | 'gmv' | 'orders' | 'impressions' | 'clicks' | 'shopGmv') =>
        rows.reduce((a, x) => a + x[k], 0);
      const cost = sum('cost'), gmv = sum('gmv'), orders = sum('orders');
      const impressions = sum('impressions'), clicks = sum('clicks'), shopGmv = sum('shopGmv');
      return {
        key: `${scope}:${r.from}~${r.to}`,
        cost: Math.round(cost), gmv: Math.round(gmv), orders: Math.round(orders),
        impressions: Math.round(impressions), clicks: Math.round(clicks), shopGmv: Math.round(shopGmv),
        // 比率一律最后再除，和页面同一套口径
        roi: +(cost === 0 ? 0 : gmv / cost).toFixed(6),
        cvr: +(clicks === 0 ? 0 : orders / clicks).toFixed(8),
        cpm: +(impressions === 0 ? 0 : (cost / impressions) * 1000).toFixed(6),
        cpc: +(clicks === 0 ? 0 : cost / clicks).toFixed(6),
      };
    }),
  );

  console.log(JSON.stringify({ aggregates: out, goals, trends, breakdowns, products, trafficChannels, searchTerms, adTotals, productDetail }));
}
main();
