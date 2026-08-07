/**
 * 交叉校验：预览页里手写的 JS 聚合，必须和 lib 的 aggregateRange 完全一致。
 * 预览页为了支持任意自定义区间，在浏览器里重写了一份聚合逻辑 ——
 * 重写就有走样的风险，这个脚本把两边的结果摆在一起比。
 */
import { getSnapshot } from '../lib/data/source';
import { aggregateRange } from '../lib/metrics';
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
  console.log(JSON.stringify(out));
}
main();
