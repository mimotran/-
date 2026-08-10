import { addDays, dayOfMonth, daysInMonth, diffDays, month, monthKey, parseDate } from '@/lib/dates';
import { aggregateRange } from '@/lib/metrics';
import type {
  AdMetric,
  Aggregate,
  DailyMetric,
  DashboardSnapshot,
  DateStr,
  KeywordMetric,
  ProductLine,
  ProductMetric,
  Target,
} from '@/lib/types';

/**
 * 演示数据。
 *
 * 量级照着真实店铺来（客单价 ~1,300、客退率 ~29%、投放费率 ~6.7%、站内 ROI ~18），
 * 这样接上真数据时页面布局不会突然崩掉 —— 用 1000 倍偏差的假数据调出来的排版，
 * 换真数据当场就溢出。
 *
 * 固定种子，结果可复现：同一天打开看到的数字永远一样，方便对着截图讨论。
 */

/** mulberry32：短小、无依赖、序列稳定 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START: DateStr = '2025-01-01';

/** 数据截至昨天 —— 天猫数据 T+1 出，今天的数还没生成 */
function yesterday(): DateStr {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// --- 商品 ---------------------------------------------------------------

interface Sku {
  itemId: string;
  title: string;
  line: ProductLine;
  price: number;
  /** 在本产品线内的销售占比权重 */
  weight: number;
}

const SKUS: Sku[] = [
  { itemId: '78210031', title: 'PLAUD NOTE Pro 旗舰版', line: 'pro', price: 1899, weight: 0.62 },
  { itemId: '78210032', title: 'PLAUD NOTE Pro 套装版', line: 'pro', price: 2199, weight: 0.38 },
  { itemId: '78210041', title: 'PLAUD NotePin 智能挂坠', line: 'pins', price: 1299, weight: 0.7 },
  { itemId: '78210042', title: 'PLAUD NotePin 礼盒装', line: 'pins', price: 1499, weight: 0.3 },
  { itemId: '78210011', title: 'PLAUD NOTE 卡片录音笔', line: 'note', price: 1099, weight: 0.55 },
  { itemId: '78210012', title: 'PLAUD NOTE 标准版', line: 'note', price: 999, weight: 0.45 },
  { itemId: '78210051', title: 'AI 会员年卡', line: 'member', price: 599, weight: 0.6 },
  { itemId: '78210052', title: 'AI 会员季卡', line: 'member', price: 199, weight: 0.4 },
  { itemId: '78210061', title: '磁吸充电底座', line: 'accessory', price: 199, weight: 0.34 },
  { itemId: '78210062', title: '保护套 / 挂绳套装', line: 'accessory', price: 99, weight: 0.36 },
  { itemId: '78210063', title: '延保服务卡', line: 'accessory', price: 299, weight: 0.3 },
];

/** 产品线在整体 GMV 里的基础占比 */
const LINE_SHARE: Record<ProductLine, number> = {
  pro: 0.4,
  note: 0.29,
  pins: 0.15,
  member: 0.09,
  accessory: 0.07,
};

// --- 投放 ---------------------------------------------------------------

/**
 * 站内触点：费用占比 + ROI + CVR + 点击率。
 *
 * 搜索三档的效率梯度是这个品类的常态：品牌词的人已经认准了要买什么，
 * ROI 和转化率都最高但量有限；品类词是主战场；其他词兜底。
 * Branding / Video / Display 是种草位，ROI 低是设计使然，不是投得差。
 */
const INSITE = [
  { channel: 'Search_品牌词', share: 0.21, roi: 34, cvr: 0.085, ctr: 0.045 },
  { channel: 'Search_品类词', share: 0.28, roi: 16, cvr: 0.042, ctr: 0.032 },
  { channel: 'Search_其他', share: 0.16, roi: 11, cvr: 0.028, ctr: 0.024 },
  { channel: 'Branding', share: 0.15, roi: 6.5, cvr: 0.012, ctr: 0.009 },
  { channel: 'Video', share: 0.12, roi: 9, cvr: 0.02, ctr: 0.014 },
  { channel: 'Display', share: 0.08, roi: 7, cvr: 0.015, ctr: 0.011 },
];

/**
 * 站外渠道：拉新为主，ROI 明显低于站内，但带来的是新客。
 *
 * CID 投放（抖音 / 小红书 / B 站）回传的通常只有消耗和归因成交，
 * 拿不到曝光和点击 —— 所以站外的表里只展示推广消耗、成交金额、ROI 三列。
 * cvr / ctr 仍然生成，是为了和站内共用一套模型，页面上不展示。
 */
const OFFSITE = [
  { channel: '抖音CID', share: 0.34, roi: 5.2, cvr: 0.011, ctr: 0.013 },
  { channel: '小红书CID', share: 0.24, roi: 4.4, cvr: 0.009, ctr: 0.012 },
  { channel: 'UD', share: 0.2, roi: 4.0, cvr: 0.008, ctr: 0.011 },
  { channel: '腾讯', share: 0.12, roi: 3.6, cvr: 0.007, ctr: 0.010 },
  { channel: 'B站CID-天猫分摊', share: 0.1, roi: 3.1, cvr: 0.006, ctr: 0.009 },
];

const KEYWORDS = [
  '录音笔',
  'plaud',
  'ai录音笔',
  '会议录音笔',
  '录音转文字',
  '智能录音笔',
  'plaud note',
  '便携录音笔',
  '录音笔 专业',
  '采访录音笔',
  'notepin',
  '录音笔 转写',
];

/**
 * 大促日历：返回当天的成交放大倍数。
 * 618 和双 11 是全年两个尖峰，年货节和 38 节是次级峰。
 */
function campaignBoost(date: DateStr): number {
  const m = month(date);
  const d = dayOfMonth(date);
  if (m === 6 && d >= 16 && d <= 20) return 4.2; // 618 正日
  if (m === 5 && d >= 26) return 2.4; // 618 预售
  if (m === 6 && d < 16) return 1.8;
  if (m === 11 && d >= 10 && d <= 13) return 4.6; // 双 11 正日
  if (m === 10 && d >= 24) return 2.6; // 双 11 预售
  if (m === 11 && d < 10) return 1.9;
  if (m === 12 && d >= 12 && d <= 15) return 1.7; // 双 12
  if (m === 1 && d >= 8 && d <= 20) return 1.5; // 年货节
  if (m === 3 && d >= 5 && d <= 9) return 1.6; // 38 节
  if (m === 8 && d >= 15 && d <= 20) return 1.4; // 88 会员节
  return 1;
}

export function buildMockSnapshot(): DashboardSnapshot {
  const rand = seeded(20260807);
  const end = yesterday();

  const daily: DailyMetric[] = [];
  const ads: AdMetric[] = [];
  const products: ProductMetric[] = [];
  const keywords: KeywordMetric[] = [];

  for (let date = START; date <= end; date = addDays(date, 1)) {
    const t = diffDays(START, date);
    const weekday = parseDate(date).getUTCDay();

    // 同比增长约 35%/年，用连续复利避免年初出现台阶
    const growth = Math.exp((t / 365) * 0.3);
    // 周末稍强，周一最弱
    const weekFactor = [0.94, 0.88, 0.93, 0.97, 1.02, 1.14, 1.12][weekday];
    const boost = campaignBoost(date);
    const noise = 0.86 + rand() * 0.28;

    const gmvTarget = 40000 * growth * weekFactor * boost * noise;

    // --- 按产品线和 SKU 分配 GMV，保证明细之和 === 大盘 ---
    let gmv = 0;
    let deviceSales = 0;
    let refund = 0;

    for (const sku of SKUS) {
      // 大促期间主机占比上升、配件下降：买手机的人不会为了赠品来
      const lineTilt =
        boost > 2 && (sku.line === 'pro' || sku.line === 'note' || sku.line === 'pins') ? 1.12 : 1;
      const share = LINE_SHARE[sku.line] * sku.weight * lineTilt * (0.9 + rand() * 0.2);
      const skuGmv = Math.round(gmvTarget * share);
      if (skuGmv <= 0) continue;

      const quantity = Math.max(1, Math.round(skuGmv / sku.price));
      // 客退率整体 ~29%，主机退得比配件多（价格高、决策重）
      const refundRate =
        (sku.line === 'member' ? 0.06 : sku.line === 'accessory' ? 0.12 : 0.31) *
        (0.85 + rand() * 0.3);
      const skuRefund = Math.round(skuGmv * refundRate);
      const skuUv = Math.round((skuGmv / 1300) * (28 + rand() * 22));

      products.push({
        date,
        line: sku.line,
        itemId: sku.itemId,
        title: sku.title,
        gmv: skuGmv,
        quantity,
        uv: skuUv,
        refund: skuRefund,
      });

      gmv += skuGmv;
      refund += skuRefund;
      if (sku.line === 'pro' || sku.line === 'note' || sku.line === 'pins') deviceSales += quantity;
    }

    // --- 流量与转化：客单价 ~1,300、转化率 ~2.3% ---
    const aov = 1250 + rand() * 180;
    const buyers = Math.max(1, Math.round(gmv / aov));
    const conversion = 0.019 + rand() * 0.009;
    const uv = Math.round(buyers / conversion);
    // 搜索 UV 占比 ~38%，大促期间被推荐流量稀释
    const searchUv = Math.round(uv * (boost > 2 ? 0.3 : 0.38) * (0.9 + rand() * 0.2));
    const orders = Math.round(buyers * (1.04 + rand() * 0.1));
    const addToCart = Math.round(uv * (0.09 + rand() * 0.035));
    // 新客率 ~88%：这个品类复购低，绝大部分是新客
    const newCustomerGmv = Math.round(gmv * (0.85 + rand() * 0.07));

    // --- 投放：总费率 ~6.7%，站内占 37% ---
    const adCostTotal = gmv * (0.055 + rand() * 0.026) * (boost > 2 ? 1.25 : 1);
    const insiteCost = adCostTotal * (0.35 + rand() * 0.05);
    const offsiteCost = adCostTotal - insiteCost;

    /**
     * 触点级指标要**互相自洽**：Sales = SPD × ROI，Order = Sales ÷ 客单价，
     * 点击 = Order ÷ CVR，曝光 = 点击 ÷ CTR。
     * 反过来先随机生成点击再算 CVR，表里就会出现「ROI 很高但 CVR 极低」这种
     * 自相矛盾的组合，运营一眼就知道数据是假的。
     */
    const emitAd = (scope: AdMetric['scope'], item: { channel: string; share: number; roi: number; cvr: number; ctr: number }, pool: number, roiTilt: number) => {
      const cost = Math.round(pool * item.share * (0.88 + rand() * 0.24));
      const roi = item.roi * (0.78 + rand() * 0.44) * roiTilt;
      const channelGmv = Math.round(cost * roi);
      const orders = Math.max(1, Math.round(channelGmv / aov));
      const cvr = item.cvr * (0.85 + rand() * 0.3);
      const clicks = Math.max(orders, Math.round(orders / cvr));
      const ctr = item.ctr * (0.85 + rand() * 0.3);
      ads.push({
        date,
        scope,
        channel: item.channel,
        cost,
        gmv: channelGmv,
        orders,
        impressions: Math.round(clicks / ctr),
        clicks,
      });
      return { cost, gmv: channelGmv };
    };

    let adCostInsite = 0;
    let adGmvInsite = 0;
    for (const item of INSITE) {
      const r = emitAd('insite', item, insiteCost, boost > 2 ? 1.15 : 1);
      adCostInsite += r.cost;
      adGmvInsite += r.gmv;
    }

    let adCostOffsite = 0;
    let adGmvOffsite = 0;
    for (const item of OFFSITE) {
      const r = emitAd('offsite', item, offsiteCost, 1);
      adCostOffsite += r.cost;
      adGmvOffsite += r.gmv;
    }

    // --- 搜索关键词：占满当天的搜索 UV ---
    let remaining = searchUv;
    let searchOrders = 0;
    KEYWORDS.forEach((keyword, index) => {
      // 齐夫分布：头部词吃掉大部分搜索量
      const share = 1 / Math.pow(index + 1.5, 1.15);
      const kwUv = index === KEYWORDS.length - 1 ? remaining : Math.round(searchUv * share * 0.42);
      const finalUv = Math.max(0, Math.min(kwUv, remaining));
      remaining -= finalUv;
      if (finalUv <= 0) return;
      // 品牌词转化率明显高于泛词
      const isBrand = keyword.includes('plaud') || keyword.includes('notepin');
      const kwConversion = (isBrand ? 0.048 : 0.014) * (0.8 + rand() * 0.4);
      const kwOrders = Math.round(finalUv * kwConversion);
      searchOrders += kwOrders;
      keywords.push({
        date,
        keyword,
        uv: finalUv,
        orders: kwOrders,
        gmv: Math.round(kwOrders * aov * (0.9 + rand() * 0.2)),
      });
    });

    // 预估利润：退后 GMV × 毛利率 − 投放费。毛利率 52–56%，硬件品牌的常见区间
    const grossMargin = 0.52 + rand() * 0.04;
    const grossProfit = Math.round((gmv - refund) * grossMargin - adCostInsite - adCostOffsite);

    daily.push({
      date,
      gmv,
      deviceSales,
      gmvAfterRefund: gmv - refund,
      refund,
      uv,
      searchUv,
      buyers,
      orders,
      addToCart,
      newCustomerGmv,
      adCostInsite,
      adCostOffsite,
      adGmvInsite,
      adGmvOffsite,
      searchOrders,
      grossProfit,
    });
  }

  return {
    source: 'mock',
    syncedAt: new Date().toISOString(),
    coverage: { from: START, to: end },
    daily,
    ads,
    products,
    keywords,
    targets: buildTargets(daily, seeded(77001)),
    warnings: [],
  };
}

/**
 * 目标。
 *
 * **全年 12 个月都要有目标**，不能只给已经产生数据的月份 ——
 * 目标是年初定的，9 月的目标 8 月就该在表里躺着了。只填有数据的月份会让
 * 季度和半年的目标算成同一个数（Q3 和 H2 都只剩 7、8 两个月），
 * 看板上就是两张一模一样的进度条。
 *
 * 尚未发生的月份用去年同月 × 增速推，没有去年数据就用今年已有月份的均值。
 * 每个指标各自定目标：绝对量按整月实际 × stretch，率型直接给一个目标率。
 */
function buildTargets(daily: DailyMetric[], rand: () => number): Target[] {
  const byMonth = new Map<string, DailyMetric[]>();
  for (const row of daily) {
    const key = monthKey(row.date);
    const list = byMonth.get(key) ?? [];
    list.push(row);
    byMonth.set(key, list);
  }

  const years = [...new Set([...byMonth.keys()].map((key) => Number(key.slice(0, 4))))].sort();
  const targets: Target[] = [];

  /** 整月口径的聚合：月份没过完时按已过天数外推，否则目标会显得虚低 */
  function fullMonth(key: string): Aggregate | null {
    const rows = byMonth.get(key);
    if (!rows || rows.length === 0) return null;
    const agg = aggregateRange(rows, { from: `${key}-01`, to: `${key}-31` });
    const days = daysInMonth(`${key}-01`);
    if (rows.length >= days) return agg;
    // 绝对量按比例外推，比率保持不变
    const scale = days / rows.length;
    return {
      ...agg,
      gmv: agg.gmv * scale,
      deviceSales: agg.deviceSales * scale,
      adCostInsite: agg.adCostInsite * scale,
      adCostOffsite: agg.adCostOffsite * scale,
      adCost: agg.adCost * scale,
      grossProfit: agg.grossProfit * scale,
      searchUv: agg.searchUv * scale,
    };
  }

  for (const y of years) {
    const monthly: Target[] = [];

    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      let base = fullMonth(key);
      let growth = 1;

      // 还没发生的月份：用去年同月 × 增速推
      if (!base) {
        base = fullMonth(`${y - 1}-${String(m).padStart(2, '0')}`);
        growth = 1.35;
      }
      if (!base) continue;

      // 每个月的进取程度不一样（0.96–1.16）：真实目标从来不是统一乘一个系数，
      // 也让演示数据里同时出现「超前」和「落后」两种状态
      const stretch = (0.96 + rand() * 0.2) * growth;
      const b = base;

      const values: Record<string, number> = {
        // 绝对量：往上提
        gmv: Math.round((b.gmv * stretch) / 10000) * 10000,
        deviceSales: Math.round((b.deviceSales * stretch) / 50) * 50,
        grossProfit: Math.round((b.grossProfit * stretch) / 10000) * 10000,
        searchUv: Math.round((b.searchUv * stretch) / 100) * 100,
        // 费用类：目标是「别超」，所以按实际略微收紧
        adCostInsite: Math.round((b.adCostInsite * growth * (1.02 + rand() * 0.12)) / 1000) * 1000,
        adCostOffsite: Math.round((b.adCostOffsite * growth * (1.02 + rand() * 0.12)) / 1000) * 1000,
        // 率型：直接给目标率，不参与上面的 stretch
        refundRate: round4(b.refundRate * (0.86 + rand() * 0.12)),
        roiInsite: round4(b.roiInsite * (1.05 + rand() * 0.35)),
        roiOffsite: round4(b.roiOffsite * (0.8 + rand() * 0.3)),
        adCostRateInsite: round4(b.adCostRateInsite * (0.95 + rand() * 0.25)),
        adCostRateOffsite: round4(b.adCostRateOffsite * (0.95 + rand() * 0.3)),
        profitRate: round4(b.profitRate * (0.94 + rand() * 0.16)),
        searchConversionRate: round4(b.searchConversionRate * (0.88 + rand() * 0.2)),
      };
      values.adCost = values.adCostInsite + values.adCostOffsite;
      values.adCostRate = round4(values.adCost / Math.max(1, values.gmv));
      // 绝对值目标要和率目标自洽：退款金额 = GMV 目标 × 退款率目标，
      // 两边各定一个会在表里出现「达成度和费率差互相矛盾」
      values.refund = Math.round((values.gmv * values.refundRate) / 1000) * 1000;
      values.searchOrders = Math.round(values.searchUv * values.searchConversionRate);

      monthly.push({ period: 'month', key, values });
    }

    targets.push(...monthly);

    // 全年目标比月度之和高 4%：年初定的时候总是乐观一点，这个缺口本身就是信息
    const sum = (k: string) => monthly.reduce((acc, t) => acc + (t.values[k] ?? 0), 0);
    targets.push({
      period: 'year',
      key: String(y),
      values: {
        gmv: Math.round((sum('gmv') * 1.04) / 100000) * 100000,
        deviceSales: Math.round((sum('deviceSales') * 1.04) / 100) * 100,
        grossProfit: Math.round((sum('grossProfit') * 1.04) / 100000) * 100000,
        searchUv: Math.round((sum('searchUv') * 1.04) / 1000) * 1000,
        refund: Math.round((sum('refund') * 1.04) / 10000) * 10000,
        searchOrders: Math.round(sum('searchOrders') * 1.04),
      },
    });
  }

  return targets;
}

function round4(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}
