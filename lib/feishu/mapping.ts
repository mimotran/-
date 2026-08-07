import type { CampaignMetric, ChannelMetric, DailyMetric, ProductMetric } from '@/lib/types';

/**
 * 飞书表头 → 看板字段的映射。
 *
 * 生意参谋导出的列名各家叫法不一（「支付金额」/「成交金额」/「GMV」都有人用），
 * 所以每个字段准备一组别名，按顺序匹配第一个命中的列。
 * 表头改了只需要在这里加一个别名，不用动其它代码。
 */

export type FieldAliases<T> = { [K in keyof T]: readonly string[] };

export const DAILY_ALIASES: FieldAliases<DailyMetric> = {
  date: ['日期', '统计日期', '时间', 'date'],
  gmv: ['支付金额', '成交金额', '支付GMV', 'GMV', '销售额', 'gmv'],
  orders: ['支付订单数', '成交订单数', '订单数', '支付子订单数', 'orders'],
  buyers: ['支付买家数', '成交买家数', '买家数', '成交人数', 'buyers'],
  uv: ['访客数', '商品访客数', 'UV', 'uv'],
  pv: ['浏览量', '商品浏览量', 'PV', 'pv'],
  addToCart: ['加购件数', '加购人数', '加购数', 'addToCart'],
  favorites: ['收藏人数', '商品收藏人数', '收藏数', 'favorites'],
  refund: ['退款金额', '成功退款金额', '退款', 'refund'],
  adCost: ['推广花费', '广告花费', '花费', '直通车花费', 'adCost'],
};

export const CHANNEL_ALIASES: FieldAliases<ChannelMetric> = {
  date: ['日期', '统计日期', 'date'],
  channel: ['流量来源', '渠道', '来源', '流量渠道', 'channel'],
  uv: ['访客数', 'UV', 'uv'],
  gmv: ['支付金额', '成交金额', 'GMV', 'gmv'],
  orders: ['支付订单数', '订单数', 'orders'],
};

export const PRODUCT_ALIASES: FieldAliases<ProductMetric> = {
  date: ['日期', '统计日期', 'date'],
  itemId: ['商品ID', '宝贝ID', '商品 ID', 'itemId', 'item_id'],
  title: ['商品名称', '宝贝标题', '商品标题', 'title'],
  category: ['类目', '一级类目', '商品类目', 'category'],
  gmv: ['支付金额', '成交金额', 'GMV', 'gmv'],
  quantity: ['支付件数', '销量', '成交件数', 'quantity'],
  uv: ['访客数', '商品访客数', 'UV', 'uv'],
  stock: ['库存', '期末库存', '可售库存', 'stock'],
};

export const CAMPAIGN_ALIASES: FieldAliases<CampaignMetric> = {
  name: ['活动名称', '活动', '名称', 'name'],
  startDate: ['开始日期', '开始时间', '起始日期', 'startDate'],
  endDate: ['结束日期', '结束时间', '截止日期', 'endDate'],
  gmv: ['支付金额', '成交金额', 'GMV', 'gmv'],
  orders: ['支付订单数', '订单数', 'orders'],
  uv: ['访客数', 'UV', 'uv'],
  cost: ['活动投入', '投入', '费用', '花费', 'cost'],
  couponRedeemed: ['优惠券核销', '券核销金额', '优惠金额', 'couponRedeemed'],
  type: ['活动类型', '玩法', '类型', 'type'],
};

/** 表头归一化：去空格、全角括号转半角、去掉单位后缀，提升匹配命中率 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
    .replace(/\((元|人|件|次|%)\)$/, '')
    .toLowerCase();
}

/** 在一行记录里按别名找值 */
export function pick(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeHeader(key), value);
  }
  for (const alias of aliases) {
    const hit = normalized.get(normalizeHeader(alias));
    if (hit !== undefined && hit !== null && hit !== '') return hit;
  }
  return undefined;
}

/**
 * 数值解析：吃掉千分位逗号、货币符号、百分号、中文单位。
 * 「1,234.56 元」→ 1234.56，「12.3%」→ 0.123。
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined) return fallback;

  // 多维表格的公式/查找列会返回 [{ text: '1234' }] 这样的数组
  if (Array.isArray(value)) return toNumber(value[0], fallback);
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; value?: unknown };
    if (obj.text !== undefined) return toNumber(obj.text, fallback);
    if (obj.value !== undefined) return toNumber(obj.value, fallback);
    return fallback;
  }

  const raw = String(value).trim();
  const isPercent = raw.endsWith('%');
  const cleaned = raw.replace(/[,，\s¥￥$元件人次%]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return fallback;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return fallback;
  return isPercent ? parsed / 100 : parsed;
}

export function toText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) {
    return value.map((item) => toText(item, '')).filter(Boolean).join('、') || fallback;
  }
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; name?: unknown };
    if (obj.text !== undefined) return toText(obj.text, fallback);
    if (obj.name !== undefined) return toText(obj.name, fallback);
    return fallback;
  }
  const raw = String(value).trim();
  return raw === '' ? fallback : raw;
}

/**
 * 日期解析：统一成 YYYY-MM-DD。
 * 支持多维表格的毫秒时间戳、Excel 序列号、以及 2026/8/7、2026-08-07、20260807、8月7日 等写法。
 */
export function toDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return toDate(value[0]);
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; value?: unknown };
    if (obj.text !== undefined) return toDate(obj.text);
    if (obj.value !== undefined) return toDate(obj.value);
    return null;
  }

  if (typeof value === 'number') {
    // 多维表格日期字段是毫秒时间戳
    if (value > 1e11) return fromTimestamp(value);
    if (value > 1e9) return fromTimestamp(value * 1000);
    // Excel / 电子表格序列号，以 1899-12-30 为原点
    if (value > 20000 && value < 80000) return fromTimestamp((value - 25569) * 86400 * 1000);
    return null;
  }

  const raw = String(value).trim();

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  const cn = raw.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?$/);
  if (cn) {
    const year = cn[1] ?? String(new Date().getUTCFullYear());
    return `${year}-${pad(cn[2])}-${pad(cn[3])}`;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : fromTimestamp(parsed);
}

function fromTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pad(value: string | number): string {
  return String(value).padStart(2, '0');
}
