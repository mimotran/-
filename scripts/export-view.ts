/**
 * 导出看板视图数据：`npm run export`
 *
 * 把 buildView 的结果落成一份 JSON，供静态预览页内联使用。
 * 预览页和 Next 应用共用同一套指标逻辑，数字不会两边对不上。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSnapshot } from '../lib/data/source';
import {
  GOAL_METRICS,
  LINE_LABELS,
  STORE_CORE,
  STORE_EXTRA,
  buildView,
} from '../lib/metrics';
import { loadLocalEnv } from './env';

loadLocalEnv();

async function main() {
  const snapshot = await getSnapshot();
  const view = buildView(snapshot, null);

  /**
   * 日序列按列存，不按行。
   *
   * 583 天 × 14 个字段，用对象数组是 `{"date":"2025-01-01","gmv":41234,...}` 重复
   * 583 遍键名；按列存只写一遍键名 + 一串数字，体积差三倍多。
   * 预览页要靠它算任意自定义区间。
   */
  const dailyKeys = [
    'gmv', 'deviceSales', 'gmvAfterRefund', 'refund', 'uv', 'searchUv',
    'buyers', 'addToCart', 'newCustomerGmv',
    'adCostInsite', 'adCostOffsite', 'adGmvInsite', 'adGmvOffsite',
    'searchBuyers', 'searchGmv', 'paidUv', 'paidGmv',
  ] as const;

  /**
   * 大部分列取整（体积小一半，且本来就是整数：人数、件数、访客）。
   * 但**派生出来的金额**要留两位小数 —— 站内/站外成交是「消耗 × ROI」算出来的，
   * 取整后再回过头除以消耗，ROI 会和源表对不上（8.76 变成 8.760045）。
   * 差值远低于显示精度，可交叉校验会一直报警，等于把哨兵调成噪音。
   */
  const keepDecimals = new Set<string>(['adGmvInsite', 'adGmvOffsite', 'newCustomerGmv']);
  const daily = {
    dates: snapshot.daily.map((row) => row.date),
    cols: Object.fromEntries(
      dailyKeys.map((key) => [
        key,
        snapshot.daily.map((row) => (keepDecimals.has(key) ? Math.round(row[key] * 100) / 100 : Math.round(row[key]))),
      ]),
    ),
  };

  /**
   * 触点 / 渠道的日明细，同样按列存并**对齐到 daily.dates**。
   *
   * 对齐是必须的：投放表可能有某天缺行（那天没投），直接按投放表自己的日期
   * 建索引，日期就和日报错位了 —— 页面上按区间求和会静默取错天数。
   */
  const dateIndex = new Map(daily.dates.map((d, i) => [d, i]));
  const adMetricKeys = ['cost', 'gmv', 'orders', 'impressions', 'clicks'] as const;

  function adColumns(scope: 'insite' | 'offsite') {
    const rows = snapshot.ads.filter((r) => r.scope === scope);
    const channels = [...new Set(rows.map((r) => r.channel))];
    return channels.map((channel) => {
      const cols = Object.fromEntries(
        adMetricKeys.map((k) => [k, new Array<number>(daily.dates.length).fill(0)]),
      ) as Record<(typeof adMetricKeys)[number], number[]>;
      for (const r of rows) {
        if (r.channel !== channel) continue;
        const i = dateIndex.get(r.date);
        if (i === undefined) continue; // 投放表有、日报没有的日期，跳过
        for (const k of adMetricKeys) cols[k][i] += Math.round(r[k]);
      }
      return { channel, ...cols };
    });
  }

  /**
   * 产品线的日明细，同样按列存并对齐到 daily.dates。
   *
   * 产品块要画「分产品每日 GMV 堆叠柱」和「月度对比」，两张图都需要按任意区间
   * 重新聚合，只有一份区间快照（view.products）是不够的。
   */
  function productColumns() {
    const lines = [...new Set(snapshot.products.map((r) => r.line))];
    return lines.map((line) => {
      const gmv = new Array<number>(daily.dates.length).fill(0);
      const quantity = new Array<number>(daily.dates.length).fill(0);
      for (const r of snapshot.products) {
        if (r.line !== line) continue;
        const i = dateIndex.get(r.date);
        if (i === undefined) continue;
        // 先累加原值再取整：逐条四舍五入会把同一天多个 SKU 的误差叠起来
        gmv[i] += r.gmv;
        quantity[i] += r.quantity;
      }
      return { line, gmv: gmv.map((v) => Math.round(v)), quantity: quantity.map((v) => Math.round(v)) };
    });
  }

  /** 流量来源日明细，同样按列存并对齐到 daily.dates */
  function trafficColumns() {
    const channels = [...new Set(snapshot.trafficChannels.map((r) => r.channel))];
    return channels.map((channel) => {
      const uv = new Array<number>(daily.dates.length).fill(0);
      const buyers = new Array<number>(daily.dates.length).fill(0);
      const gmv = new Array<number>(daily.dates.length).fill(0);
      for (const r of snapshot.trafficChannels) {
        if (r.channel !== channel) continue;
        const i = dateIndex.get(r.date);
        if (i === undefined) continue;
        uv[i] += r.uv; buyers[i] += r.buyers; gmv[i] += r.gmv;
      }
      return {
        channel,
        uv: uv.map((v) => Math.round(v)),
        buyers: buyers.map((v) => Math.round(v)),
        gmv: gmv.map((v) => Math.round(v)),
      };
    });
  }

  /**
   * 搜索词长表：CSR（压缩稀疏行）编码。
   *
   * 5,829 个词 × 222 天，按稠密矩阵存是 129 万个格子，其中 98% 是 0 ——
   * 绝大多数长尾词一年只出现过几天。改成「每个词只存它出现过的日子」：
   * `d`/`v` 是所有词的 (日索引, 访客数) 首尾相接，`off` 记第 t 个词在里面的
   * 起止，`d.slice(off[t], off[t+1])` 就是那个词的日序列。
   *
   * 为什么不只导出 Top 100：区间是可变的（近 7 天 / 自定义都行），某个词在
   * 某一周冲进前 100、在全年榜上却排到几百名是常事。而且页面上有搜索框，
   * 搜的是全量词表。截断会让「匹配 N 条」和占比分母都变成假的。
   */
  function keywordBlock() {
    const rows = snapshot.searchTerms;
    const order = new Map<string, number>();
    const kinds: number[] = [];
    const KIND_CODE: Record<string, number> = { brand: 0, category: 1, other: 2 };

    // 先按全年访客降序给词编号：页面默认按访客排，编号有序时不用再排一遍全表
    const totals = new Map<string, { uv: number; kind: string }>();
    for (const r of rows) {
      const prev = totals.get(r.term);
      if (prev) prev.uv += r.uv;
      else totals.set(r.term, { uv: r.uv, kind: r.kind });
    }
    const terms = [...totals.entries()].sort((a, b) => b[1].uv - a[1].uv || a[0].localeCompare(b[0]));
    terms.forEach(([term, meta], i) => { order.set(term, i); kinds.push(KIND_CODE[meta.kind] ?? 2); });

    const buckets: Array<Array<[number, number]>> = terms.map(() => []);
    const base = new Array<number>(daily.dates.length).fill(0);
    for (const r of rows) {
      const di = dateIndex.get(r.date);
      const ti = order.get(r.term);
      if (di === undefined || ti === undefined) continue; // 长表有、日报没有的日期
      buckets[ti].push([di, Math.round(r.uv)]);
      base[di] += r.uv;
    }

    const off: number[] = [0];
    const d: number[] = [];
    const v: number[] = [];
    for (const bucket of buckets) {
      bucket.sort((a, b) => a[0] - b[0]);
      for (const [di, uv] of bucket) { d.push(di); v.push(uv); }
      off.push(d.length);
    }

    return {
      terms: terms.map(([t]) => t),
      kind: kinds,
      off, d, v,
      base: base.map((x) => Math.round(x)),
      /** 日报口径的搜索 UV，用来在注脚里算长表的覆盖率 */
      searchUv: snapshot.daily.map((row) => Math.round(row.searchUv)),
    };
  }

  /** 指标定义随数据一起导出：预览页只按 key 取值，不重复维护一份标签表 */
  const spec = (list: typeof STORE_CORE) =>
    list.map((m) => ({ key: m.key, label: m.label, format: m.format, higherIsBetter: m.higherIsBetter }));

  const payload = {
    daily,
    adDaily: { insite: adColumns('insite'), offsite: adColumns('offsite') },
    productDaily: productColumns(),
    trafficDaily: trafficColumns(),
    kw: keywordBlock(),
    productLabels: Object.fromEntries(
      [...new Set(snapshot.products.map((r) => r.line))].map((l) => [l, LINE_LABELS[l]]),
    ),
    storeMetrics: { core: spec(STORE_CORE), extra: spec(STORE_EXTRA) },
    // 目标定义 + 月度目标：预览页要靠它们算任意自定义区间的达成
    goalMetrics: GOAL_METRICS.map((m) => ({
      key: m.key, label: m.label, group: m.group, format: m.format,
      higherIsBetter: m.higherIsBetter,
      weightBy: m.weightBy ?? null, emphasis: m.emphasis === true,
      monthlyOnly: m.monthlyOnly === true,
      monthlyRatioOf: m.monthlyRatioOf ?? null,
    })),
    targets: snapshot.targets,
    monthlyActuals: snapshot.monthlyActuals,
    source: snapshot.source,
    syncedAt: snapshot.syncedAt,
    latestDate: view.latestDate,
    earliestDate: view.earliestDate,
    // 周期与 KPI：只留展示需要的字段，别把整份聚合塞进页面
    stats: view.stats.map((stat) => ({
      key: stat.period.key,
      label: stat.period.label,
      compareLabel: stat.period.compareLabel,
      range: stat.period.range,
      compareRange: stat.period.compareRange,
      core: stat.core,
      extra: stat.extra,
      ads: stat.ads,
      aggregate: stat.aggregate,
    })),
    goals: view.goals,
    insite: view.insite,
    offsite: view.offsite,
    products: view.products,
    trafficChannels: view.trafficChannels,
    breakdownLabel: view.breakdownPeriod.label,
    breakdownRange: view.breakdownPeriod.range,
  };

  const out = resolve(process.cwd(), process.argv[2] ?? 'view.json');
  writeFileSync(out, JSON.stringify(payload), 'utf8');

  const kb = Math.round(JSON.stringify(payload).length / 1024);
  console.log(`✓ 导出 ${out}（${kb} KB，来源 ${snapshot.source}，截至 ${view.latestDate}）`);
}

main().catch((err) => {
  console.error('导出失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
