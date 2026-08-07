import type { CampaignMetric, ChannelMetric, DailyMetric, ProductMetric } from '@/lib/types';
import {
  CAMPAIGN_ALIASES,
  CHANNEL_ALIASES,
  DAILY_ALIASES,
  PRODUCT_ALIASES,
  pick,
  toDate,
  toNumber,
  toText,
} from './mapping';

/**
 * 把飞书表里的原始行转成看板数据模型。
 *
 * 解析原则：**坏行跳过，不是整表报错**。运营在表里加一行备注、留一行空白、
 * 或者某天忘了填日期，都不该让整个看板挂掉 —— 记一条 warning 展示在页面上就够了。
 */

export interface ParseResult<T> {
  rows: T[];
  warnings: string[];
}

const CAMPAIGN_TYPES: CampaignMetric['type'][] = ['大促', '日常活动', '直播', '短视频'];

export function parseDaily(raw: Array<Record<string, unknown>>): ParseResult<DailyMetric> {
  const warnings: string[] = [];
  const byDate = new Map<string, DailyMetric>();

  raw.forEach((row, index) => {
    const date = toDate(pick(row, DAILY_ALIASES.date));
    if (!date) {
      warnings.push(`日报表第 ${index + 2} 行没有可识别的日期，已跳过`);
      return;
    }
    const metric: DailyMetric = {
      date,
      gmv: toNumber(pick(row, DAILY_ALIASES.gmv)),
      orders: toNumber(pick(row, DAILY_ALIASES.orders)),
      buyers: toNumber(pick(row, DAILY_ALIASES.buyers)),
      uv: toNumber(pick(row, DAILY_ALIASES.uv)),
      pv: toNumber(pick(row, DAILY_ALIASES.pv)),
      addToCart: toNumber(pick(row, DAILY_ALIASES.addToCart)),
      favorites: toNumber(pick(row, DAILY_ALIASES.favorites)),
      refund: toNumber(pick(row, DAILY_ALIASES.refund)),
      adCost: toNumber(pick(row, DAILY_ALIASES.adCost)),
    };
    // 同一天出现多行时后写的覆盖前面的，方便运营直接在表尾追加修正行
    if (byDate.has(date)) {
      warnings.push(`日报表 ${date} 有重复行，以最后一行为准`);
    }
    byDate.set(date, metric);
  });

  return { rows: sortByDate([...byDate.values()]), warnings };
}

export function parseChannels(raw: Array<Record<string, unknown>>): ParseResult<ChannelMetric> {
  const warnings: string[] = [];
  const rows: ChannelMetric[] = [];

  raw.forEach((row, index) => {
    const date = toDate(pick(row, CHANNEL_ALIASES.date));
    const channel = toText(pick(row, CHANNEL_ALIASES.channel));
    if (!date || !channel) {
      warnings.push(`流量渠道表第 ${index + 2} 行缺少日期或渠道名，已跳过`);
      return;
    }
    rows.push({
      date,
      channel,
      uv: toNumber(pick(row, CHANNEL_ALIASES.uv)),
      gmv: toNumber(pick(row, CHANNEL_ALIASES.gmv)),
      orders: toNumber(pick(row, CHANNEL_ALIASES.orders)),
    });
  });

  return { rows: sortByDate(rows), warnings };
}

export function parseProducts(raw: Array<Record<string, unknown>>): ParseResult<ProductMetric> {
  const warnings: string[] = [];
  const rows: ProductMetric[] = [];

  raw.forEach((row, index) => {
    const date = toDate(pick(row, PRODUCT_ALIASES.date));
    const title = toText(pick(row, PRODUCT_ALIASES.title));
    const itemId = toText(pick(row, PRODUCT_ALIASES.itemId), title);
    if (!date || !itemId) {
      warnings.push(`商品明细表第 ${index + 2} 行缺少日期或商品标识，已跳过`);
      return;
    }
    rows.push({
      date,
      itemId,
      title: title || itemId,
      category: toText(pick(row, PRODUCT_ALIASES.category), '未分类'),
      gmv: toNumber(pick(row, PRODUCT_ALIASES.gmv)),
      quantity: toNumber(pick(row, PRODUCT_ALIASES.quantity)),
      uv: toNumber(pick(row, PRODUCT_ALIASES.uv)),
      stock: toNumber(pick(row, PRODUCT_ALIASES.stock)),
    });
  });

  return { rows: sortByDate(rows), warnings };
}

export function parseCampaigns(raw: Array<Record<string, unknown>>): ParseResult<CampaignMetric> {
  const warnings: string[] = [];
  const rows: CampaignMetric[] = [];

  raw.forEach((row, index) => {
    const name = toText(pick(row, CAMPAIGN_ALIASES.name));
    const startDate = toDate(pick(row, CAMPAIGN_ALIASES.startDate));
    const endDate = toDate(pick(row, CAMPAIGN_ALIASES.endDate)) ?? startDate;
    if (!name || !startDate || !endDate) {
      warnings.push(`活动表第 ${index + 2} 行缺少活动名或起止日期，已跳过`);
      return;
    }
    const rawType = toText(pick(row, CAMPAIGN_ALIASES.type), '日常活动');
    const type = CAMPAIGN_TYPES.find((candidate) => rawType.includes(candidate)) ?? '日常活动';

    rows.push({
      name,
      startDate,
      endDate,
      type,
      gmv: toNumber(pick(row, CAMPAIGN_ALIASES.gmv)),
      orders: toNumber(pick(row, CAMPAIGN_ALIASES.orders)),
      uv: toNumber(pick(row, CAMPAIGN_ALIASES.uv)),
      cost: toNumber(pick(row, CAMPAIGN_ALIASES.cost)),
      couponRedeemed: toNumber(pick(row, CAMPAIGN_ALIASES.couponRedeemed)),
    });
  });

  return { rows: rows.sort((a, b) => a.startDate.localeCompare(b.startDate)), warnings };
}

function sortByDate<T extends { date: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
