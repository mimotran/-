import type {
  CampaignMetric,
  ChannelMetric,
  DailyMetric,
  DashboardSnapshot,
  ProductMetric,
} from '@/lib/types';

/**
 * Mock 数据源：飞书还没接上时让看板能完整跑起来。
 *
 * 用固定种子的伪随机数，同一天生成的结果始终一致 —— 否则每次刷新数字都在跳，
 * 既没法验证 UI，服务端和客户端渲染也会对不上。
 */

/** mulberry32：小而稳的 32 位种子随机数 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把日期字符串变成稳定的种子，保证「某一天的数据」永远长一个样 */
function seedOf(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const CHANNELS = [
  { name: '手淘搜索', share: 0.28, convRate: 1.25 },
  { name: '手淘推荐', share: 0.22, convRate: 0.7 },
  { name: '直通车', share: 0.16, convRate: 1.1 },
  { name: '万相台', share: 0.12, convRate: 1.0 },
  { name: '内容场（直播/短视频）', share: 0.11, convRate: 1.35 },
  { name: '淘宝客', share: 0.07, convRate: 0.9 },
  { name: '其他', share: 0.04, convRate: 0.6 },
] as const;

const PRODUCTS = [
  { itemId: '68210034', title: '录音笔 Note Pro 旗舰版', category: '智能硬件', price: 1299, weight: 0.24 },
  { itemId: '68210035', title: '录音笔 Note Air 轻薄款', category: '智能硬件', price: 799, weight: 0.19 },
  { itemId: '68210036', title: 'AI 会议助手套装', category: '智能硬件', price: 1899, weight: 0.13 },
  { itemId: '68210037', title: '便携降噪麦克风', category: '配件', price: 329, weight: 0.11 },
  { itemId: '68210038', title: '磁吸充电底座', category: '配件', price: 149, weight: 0.09 },
  { itemId: '68210039', title: '真皮保护套', category: '配件', price: 99, weight: 0.08 },
  { itemId: '68210040', title: '云存储年卡 200G', category: '增值服务', price: 199, weight: 0.06 },
  { itemId: '68210041', title: '转写时长包 1000 分钟', category: '增值服务', price: 99, weight: 0.05 },
  { itemId: '68210042', title: '延保服务两年', category: '增值服务', price: 259, weight: 0.03 },
  { itemId: '68210043', title: '录音笔入门款 Lite', category: '智能硬件', price: 499, weight: 0.02 },
] as const;

/** 大促日历：进入这些区间时整体流量和转化都会抬起来 */
const PROMO_WINDOWS = [
  { name: '618 预售', from: '05-26', to: '05-31', lift: 1.9, type: '大促' as const },
  { name: '618 现货', from: '06-16', to: '06-20', lift: 3.4, type: '大促' as const },
  { name: '99 划算节', from: '09-09', to: '09-11', lift: 1.6, type: '日常活动' as const },
  { name: '双11 预售', from: '10-20', to: '10-31', lift: 2.2, type: '大促' as const },
  { name: '双11 现货', from: '11-01', to: '11-12', lift: 4.1, type: '大促' as const },
  { name: '双12', from: '12-10', to: '12-12', lift: 1.7, type: '日常活动' as const },
  { name: '年货节', from: '01-10', to: '01-20', lift: 1.5, type: '日常活动' as const },
];

function promoLift(date: string): { lift: number; name: string | null } {
  const md = date.slice(5);
  for (const window of PROMO_WINDOWS) {
    if (md >= window.from && md <= window.to) return { lift: window.lift, name: window.name };
  }
  return { lift: 1, name: null };
}

/**
 * 把一个整数总量按权重精确拆分：结果之和**严格等于** total。
 *
 * 这不是洁癖 —— 渠道分项加起来对不上大盘、商品明细之和不等于当日 GMV，
 * 运营第一次核对就会发现，之后整个看板的数字都不会有人再信。
 * 用最大余额法：先取整，再把余下的份额按小数部分从大到小补回去。
 */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (total * weight) / sum);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((acc, value) => acc + value, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }

  return floors;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 生成截止到 `endDate`、往前 `days` 天的完整快照。
 * 默认 400 天，保证 90 天区间也能算出去年同期。
 */
export function buildMockSnapshot(endDate: string, days = 400): DashboardSnapshot {
  const end = new Date(`${endDate}T00:00:00Z`);
  const daily: DailyMetric[] = [];
  const channels: ChannelMetric[] = [];
  const products: ProductMetric[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const day = addDays(end, -offset);
    const date = iso(day);
    const rand = seeded(seedOf(date));

    // 周末流量抬一档，周三最低
    const dow = day.getUTCDay();
    const weekly = [0.94, 0.9, 0.92, 0.88, 0.96, 1.12, 1.18][dow];
    // 一年 12% 的自然增长
    const growth = 1 + ((days - offset) / 365) * 0.12;
    const { lift } = promoLift(date);
    const noise = 0.88 + rand() * 0.24;

    const uv = Math.round(12800 * weekly * growth * lift * noise);
    const pv = Math.round(uv * (2.6 + rand() * 0.6));
    // 大促期间转化率本身也会走高
    const convRate = (0.021 + rand() * 0.006) * (1 + (lift - 1) * 0.22);
    const orders = Math.max(1, Math.round(uv * convRate));
    const buyers = Math.round(orders * (0.86 + rand() * 0.08));
    const aov = 620 * (1 + (rand() - 0.5) * 0.16) * (lift > 1.5 ? 1.12 : 1);
    const gmv = Math.round(orders * aov);

    daily.push({
      date,
      gmv,
      orders,
      buyers,
      uv,
      pv,
      addToCart: Math.round(uv * (0.058 + rand() * 0.02)),
      favorites: Math.round(uv * (0.031 + rand() * 0.012)),
      refund: Math.round(gmv * (0.035 + rand() * 0.025)),
      adCost: Math.round(gmv * (0.11 + rand() * 0.05)),
    });

    // 渠道拆分：访客按份额切，成交再叠加各渠道自身的转化系数
    const uvWeights = CHANNELS.map((ch) => ch.share * (0.85 + rand() * 0.3));
    const gmvWeights = CHANNELS.map((ch, i) => uvWeights[i] * ch.convRate);
    const chUv = allocate(uv, uvWeights);
    const chGmv = allocate(gmv, gmvWeights);
    const chOrders = allocate(orders, gmvWeights);

    CHANNELS.forEach((ch, i) => {
      channels.push({ date, channel: ch.name, uv: chUv[i], gmv: chGmv[i], orders: chOrders[i] });
    });

    // 商品明细只留最近 120 天，避免快照文件过大
    if (offset < 120) {
      const productWeights = PRODUCTS.map((product) => product.weight * (0.75 + rand() * 0.5));
      const pGmv = allocate(gmv, productWeights);
      const pUv = allocate(Math.round(uv * 1.4), productWeights);

      PRODUCTS.forEach((product, i) => {
        products.push({
          date,
          itemId: product.itemId,
          title: product.title,
          category: product.category,
          gmv: pGmv[i],
          quantity: Math.max(0, Math.round(pGmv[i] / product.price)),
          uv: pUv[i],
          stock: Math.round(400 + rand() * 2600),
        });
      });
    }
  }

  return {
    source: 'mock',
    syncedAt: new Date(`${endDate}T02:30:00Z`).toISOString(),
    coverage: { from: daily[0].date, to: daily[daily.length - 1].date },
    daily,
    channels,
    products,
    campaigns: buildMockCampaigns(daily),
    warnings: [],
  };
}

/** 活动数据直接从日报里按大促窗口聚合，保证两边对得上 */
function buildMockCampaigns(daily: DailyMetric[]): CampaignMetric[] {
  const campaigns = new Map<string, CampaignMetric>();

  for (const day of daily) {
    const { name } = promoLift(day.date);
    if (!name) continue;
    // 同名活动跨年时按年份区分，「2025 双11 现货」和「2026 双11 现货」不能混在一起
    const key = `${day.date.slice(0, 4)} ${name}`;
    const window = PROMO_WINDOWS.find((w) => w.name === name)!;
    const existing = campaigns.get(key);

    if (existing) {
      existing.endDate = day.date;
      existing.gmv += day.gmv;
      existing.orders += day.orders;
      existing.uv += day.uv;
      existing.cost += day.adCost;
      existing.couponRedeemed += Math.round(day.gmv * 0.06);
    } else {
      campaigns.set(key, {
        name: key,
        startDate: day.date,
        endDate: day.date,
        gmv: day.gmv,
        orders: day.orders,
        uv: day.uv,
        cost: day.adCost,
        couponRedeemed: Math.round(day.gmv * 0.06),
        type: window.type,
      });
    }
  }

  return [...campaigns.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}
