/**
 * 交叉校验：预览页里手写的 JS 聚合，必须和 lib 的 aggregateRange 完全一致。
 * 预览页为了支持任意自定义区间，在浏览器里重写了一份聚合逻辑 ——
 * 重写就有走样的风险，这个脚本把两边的结果摆在一起比。
 */
import { getSnapshot } from '../lib/data/source';
import { aggregateRange, buildGoals } from '../lib/metrics';
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
    const period = buildGoals(snap.daily, snap.targets, latest, r).find((p) => p.key === 'custom');
    return {
      range: `${r.from}~${r.to}`,
      timeProgress: +(period?.timeProgress ?? 0).toFixed(6),
      rows: (period?.groups ?? []).flatMap((g) => g.rows).map((row) => ({
        key: row.key,
        target: row.target === null ? null : +row.target.toFixed(4),
        actual: +row.actual.toFixed(4),
        attainment: row.attainment === null ? null : +row.attainment.toFixed(6),
        ppDiff: row.ppDiff === null ? null : +row.ppDiff.toFixed(6),
        good: row.good,
        rateGood: row.rateGood,
      })),
    };
  });

  console.log(JSON.stringify({ aggregates: out, goals }));
}
main();
