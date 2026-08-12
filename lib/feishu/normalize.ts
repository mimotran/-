import type {
  AdMetric,
  AdScope,
  DailyMetric,
  ProductLine,
  ProductMetric,
  Target,
} from '@/lib/types';
import {
  AD_ALIASES,
  DAILY_ALIASES,
  LINE_PATTERNS,
  PRODUCT_ALIASES,
  TARGET_ALIASES,
  TARGET_METRIC_ALIASES,
  pick,
  toDate,
  toMonthKey,
  toNumber,
  toText,
} from './mapping';

/**
 * 把飞书表里的原始行转成看板数据模型。
 *
 * 解析原则：**坏行跳过，不是整表报错**。运营在表里加一行备注、留一行空白、
 * 或者某天忘了填日期，都不该让整个看板挂掉 —— 记一条 warning 展示在页面上就够了。
 *
 * 另一条原则：模型里只存**可加的量**。表里给的是比率时（客退率、新客率、ROI），
 * 在这里乘出绝对值，别把比率带进聚合层 —— 比率的平均值没有意义。
 */

export interface ParseResult<T> {
  rows: T[];
  warnings: string[];
}

/** 取值：优先用绝对值列，没有就用比率列乘基数反推 */
function absoluteOr(
  row: Record<string, unknown>,
  absoluteKey: string,
  rateKey: string,
  base: number,
): number {
  const absolute = pick(row, DAILY_ALIASES[absoluteKey]);
  if (absolute !== undefined) return toNumber(absolute);
  const rate = pick(row, DAILY_ALIASES[rateKey]);
  return rate !== undefined ? toNumber(rate) * base : 0;
}

export function parseDaily(raw: Array<Record<string, unknown>>, defaultYear?: number): ParseResult<DailyMetric> {
  const warnings: string[] = [];
  const byDate = new Map<string, DailyMetric>();
  let skipped = 0;

  raw.forEach((row) => {
    const date = toDate(pick(row, DAILY_ALIASES.date), defaultYear);
    if (!date) {
      // 汇总行（「全年汇总」「月汇总」）和分节标题行都没有日期，静默跳过 ——
      // 这类行在真实日报里很多，逐行报 warning 会把告警区刷屏
      skipped += 1;
      return;
    }

    const gmv = toNumber(pick(row, DAILY_ALIASES.gmv));
    const refund = absoluteOr(row, 'refund', 'refundRate', gmv);

    // 站内 / 站外投放费：表里可能只给总投放费 + 站内消耗，站外要减出来
    const adCostTotal = toNumber(pick(row, DAILY_ALIASES.adCost));
    let adCostInsite = absoluteOr(row, 'adCostInsite', 'adCostRateInsite', gmv);
    let adCostOffsite = absoluteOr(row, 'adCostOffsite', 'adCostRateOffsite', gmv);
    if (adCostTotal > 0) {
      if (adCostInsite > 0 && adCostOffsite === 0) adCostOffsite = Math.max(0, adCostTotal - adCostInsite);
      else if (adCostOffsite > 0 && adCostInsite === 0) adCostInsite = Math.max(0, adCostTotal - adCostOffsite);
      else if (adCostInsite === 0 && adCostOffsite === 0) adCostInsite = adCostTotal;
    }

    // 成交额优先取绝对值列，没有就用 ROI 乘投放费
    const adGmvInsiteRaw = pick(row, DAILY_ALIASES.adGmvInsite);
    const adGmvInsite =
      adGmvInsiteRaw !== undefined
        ? toNumber(adGmvInsiteRaw)
        : toNumber(pick(row, DAILY_ALIASES.roiInsite)) * adCostInsite;

    const adGmvOffsiteRaw = pick(row, DAILY_ALIASES.adGmvOffsite);
    const adGmvOffsite =
      adGmvOffsiteRaw !== undefined
        ? toNumber(adGmvOffsiteRaw)
        : toNumber(pick(row, DAILY_ALIASES.roiOffsite)) * adCostOffsite;

    const gmvAfterRefundRaw = pick(row, DAILY_ALIASES.gmvAfterRefund);

    const metric: DailyMetric = {
      date,
      gmv,
      deviceSales: toNumber(pick(row, DAILY_ALIASES.deviceSales)),
      gmvAfterRefund: gmvAfterRefundRaw !== undefined ? toNumber(gmvAfterRefundRaw) : gmv - refund,
      refund,
      uv: toNumber(pick(row, DAILY_ALIASES.uv)),
      searchUv: toNumber(pick(row, DAILY_ALIASES.searchUv)),
      buyers: toNumber(pick(row, DAILY_ALIASES.buyers)),
      addToCart: toNumber(pick(row, DAILY_ALIASES.addToCart)),
      newCustomerGmv: absoluteOr(row, 'newCustomerGmv', 'newCustomerRate', gmv),
      adCostInsite,
      adCostOffsite,
      adGmvInsite,
      adGmvOffsite,
      // 搜索支付人数：表里没有就用搜索转化率乘搜索 UV 兜底，是个近似
      searchBuyers: (() => {
        const direct = pick(row, DAILY_ALIASES.searchBuyers);
        if (direct !== undefined) return toNumber(direct);
        const rate = toNumber(pick(row, DAILY_ALIASES.searchConversionRate));
        return rate > 0 ? Math.round(toNumber(pick(row, DAILY_ALIASES.searchUv)) * rate) : 0;
      })(),
      /**
       * 搜索成交：优先绝对值；其次「搜索 UV 价值 × 搜索 UV」；再次「成交占比 × GMV」。
       * 三条路都走不通就留 0 —— 宁可让搜索 UV 价值显示为 0，也不要拿总转化率
       * 乘出一个看起来合理、实际是编的数。
       */
      searchGmv: (() => {
        const direct = pick(row, DAILY_ALIASES.searchGmv);
        if (direct !== undefined) return toNumber(direct);
        const uvValue = pick(row, DAILY_ALIASES.searchUvValue);
        if (uvValue !== undefined) {
          return toNumber(uvValue) * toNumber(pick(row, DAILY_ALIASES.searchUv));
        }
        const share = pick(row, DAILY_ALIASES.searchGmvShare);
        return share !== undefined ? toNumber(share) * gmv : 0;
      })(),
      // 付费 UV：表里没有就用「付费 UV 占比 × 总 UV」反推
      paidUv: (() => {
        const direct = pick(row, DAILY_ALIASES.paidUv);
        if (direct !== undefined) return toNumber(direct);
        const share = pick(row, DAILY_ALIASES.paidUvShare);
        return share !== undefined ? Math.round(toNumber(share) * toNumber(pick(row, DAILY_ALIASES.uv))) : 0;
      })(),
      paidGmv: toNumber(pick(row, DAILY_ALIASES.paidGmv)),
      campaign: toText(pick(row, DAILY_ALIASES.campaign)) || '日常',
    };

    // 同一天出现多行时后写的覆盖前面的，方便运营直接在表尾追加修正行
    if (byDate.has(date)) {
      warnings.push(`日报表 ${date} 有重复行，以最后一行为准`);
    }
    byDate.set(date, metric);
  });

  if (skipped > 0) {
    warnings.push(`日报表有 ${skipped} 行没有可识别的日期（汇总行 / 空行），已跳过`);
  }

  return { rows: sortByDate([...byDate.values()]), warnings };
}

/**
 * 投放明细。
 *
 * `scope` 优先取参数（站内表 / 站外表分开配），表里自带「投放类型」列时以列为准 ——
 * 有些团队把站内外放在同一张表里。
 */
export function parseAds(
  raw: Array<Record<string, unknown>>,
  defaultScope: AdScope,
  defaultYear?: number,
): ParseResult<AdMetric> {
  const warnings: string[] = [];
  const rows: AdMetric[] = [];
  let skipped = 0;

  raw.forEach((row) => {
    const date = toDate(pick(row, AD_ALIASES.date), defaultYear);
    const channel = toText(pick(row, AD_ALIASES.channel));
    if (!date || !channel) {
      skipped += 1;
      return;
    }

    const scopeText = toText(pick(row, AD_ALIASES.scope));
    const scope: AdScope = scopeText.includes('站外')
      ? 'offsite'
      : scopeText.includes('站内')
        ? 'insite'
        : defaultScope;

    const cost = toNumber(pick(row, AD_ALIASES.cost));
    const gmvRaw = pick(row, AD_ALIASES.gmv);
    const gmv = gmvRaw !== undefined ? toNumber(gmvRaw) : toNumber(pick(row, AD_ALIASES.roi)) * cost;

    const clicks = toNumber(pick(row, AD_ALIASES.clicks));
    const ordersRaw = pick(row, AD_ALIASES.orders);

    rows.push({
      date,
      scope,
      channel,
      cost,
      gmv,
      // 订单数优先取绝对值列，没有就用 CVR 乘点击量反推
      orders: ordersRaw !== undefined ? toNumber(ordersRaw) : Math.round(toNumber(pick(row, AD_ALIASES.cvr)) * clicks),
      impressions: toNumber(pick(row, AD_ALIASES.impressions)),
      clicks,
    });
  });

  if (skipped > 0) warnings.push(`投放表有 ${skipped} 行缺少日期或触点/渠道名，已跳过`);
  return { rows: sortByDate(rows), warnings };
}

/** 从标题或产品线列认产品线，认不出归到配件 */
function resolveLine(explicit: string, title: string): ProductLine {
  const text = `${explicit} ${title}`;
  for (const pattern of LINE_PATTERNS) {
    if (pattern.test.test(text)) return pattern.line as ProductLine;
  }
  return 'accessory';
}

export function parseProducts(
  raw: Array<Record<string, unknown>>,
  defaultYear?: number,
): ParseResult<ProductMetric> {
  const warnings: string[] = [];
  const rows: ProductMetric[] = [];
  let skipped = 0;

  raw.forEach((row) => {
    const date = toDate(pick(row, PRODUCT_ALIASES.date), defaultYear);
    const title = toText(pick(row, PRODUCT_ALIASES.title));
    const itemId = toText(pick(row, PRODUCT_ALIASES.itemId), title);
    if (!date || !itemId) {
      skipped += 1;
      return;
    }

    rows.push({
      date,
      itemId,
      title: title || itemId,
      line: resolveLine(toText(pick(row, PRODUCT_ALIASES.line)), title),
      gmv: toNumber(pick(row, PRODUCT_ALIASES.gmv)),
      buyers: toNumber(pick(row, PRODUCT_ALIASES.buyers)),
      quantity: toNumber(pick(row, PRODUCT_ALIASES.quantity)),
      uv: toNumber(pick(row, PRODUCT_ALIASES.uv)),
      refund: toNumber(pick(row, PRODUCT_ALIASES.refund)),
    });
  });

  if (skipped > 0) warnings.push(`商品表有 ${skipped} 行缺少日期或商品标识，已跳过`);
  return { rows: sortByDate(rows), warnings };
}

export function parseTargets(
  raw: Array<Record<string, unknown>>,
  defaultYear?: number,
): ParseResult<Target> {
  const warnings: string[] = [];
  const rows: Target[] = [];
  let skipped = 0;

  raw.forEach((row) => {
    const keyText = toText(pick(row, TARGET_ALIASES.key));
    if (!keyText) {
      skipped += 1;
      return;
    }

    // 目标表一行一个周期，一列一个指标；只收表里真有的列，缺的留空由上层降级
    const values: Record<string, number> = {};
    for (const [metric, aliases] of Object.entries(TARGET_METRIC_ALIASES)) {
      const raw = pick(row, aliases);
      if (raw === undefined) continue;
      const value = toNumber(raw, NaN);
      if (Number.isFinite(value)) values[metric] = value;
    }

    if (Object.keys(values).length === 0) {
      skipped += 1;
      return;
    }

    // 纯四位数字当年度目标，其余按月份解析
    const yearOnly = keyText.match(/^(\d{4})\s*年?$/);
    if (yearOnly) {
      rows.push({ period: 'year', key: yearOnly[1], values });
      return;
    }

    const key = toMonthKey(keyText, defaultYear);
    if (!key) {
      skipped += 1;
      return;
    }
    rows.push({ period: 'month', key, values });
  });

  if (skipped > 0) warnings.push(`目标表有 ${skipped} 行无法识别周期或没有任何目标值，已跳过`);
  return { rows, warnings };
}

function sortByDate<T extends { date: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
