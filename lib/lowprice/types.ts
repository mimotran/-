/**
 * 低价链接监测 —— 数据模型。
 *
 * 一行 = 一次巡检记录（某天、某平台、某条商品链接的一次抓价）。
 * 「排查记录」是事实表，看板和明细页都只是它的展示层，所以这里只放**源表里有的**
 * 原始字段：价差、低价幅度、风险等级一律由 lib/lowprice/rules.js 现算，不落库。
 */

export interface LinkRecord {
  /** 源表序号；缺失时用行号补，只用来让排序稳定 */
  seq: number;
  /** 排查日期，YYYY-MM-DD */
  date: string;
  platform: string;
  /** 卖家昵称 / 店铺名称 */
  shop: string;
  /** 卖家 ID/UID，店铺去重的首选键 */
  sellerId: string;
  shopType: string;
  model: string;
  version: string;
  /** 发现价格（元）。源表空着时为 null，不要当成 0 */
  price: number | null;
  /** 官方指导价（元） */
  listPrice: number | null;
  /** 月销。源表空着时为 null */
  monthlySales: number | null;
  region: string;
  note: string;
  url: string;
  shopUrl: string;
}

/** 店铺聚合行，由 rules.js 的 aggregateShops 现算 */
export interface ShopAggregate {
  key: string;
  shop: string;
  sellerId: string;
  platform: string;
  shopType: string;
  shopUrl: string;
  records: number;
  low: number;
  severe: number;
  maxRate: number | null;
  minPrice: number | null;
  models: string[];
  latest: string;
}

export interface LinkSummary {
  /** 当前筛选结果的记录条数 */
  records: number;
  /** 去重后的链接数 */
  links: number;
  low: number;
  lowLinks: number;
  lowRate: number;
  /** 有低价链接的店铺去重数（= 源表「看板」页的「涉及店铺」口径） */
  shops: number;
  /** 当前筛选下的全部店铺去重数 */
  allShops: number;
  severe: number;
  abnormal: number;
  /** 缺官方指导价 / 发现价格，算不出幅度的条数 */
  unknown: number;
}

export interface LinkFilters {
  dateFrom: string;
  dateTo: string;
  platform: string;
  model: string;
  version: string;
  shopType: string;
  region: string;
  lowPrice: 'all' | 'low' | 'normal';
  band: 'all' | 'mild' | 'medium' | 'high' | 'severe';
  q: string;
}

export interface LinkSnapshot {
  rows: LinkRecord[];
  /** feishu = 真实数据；none = 没接上数据源，页面走空态，绝不发演示数据 */
  source: 'feishu' | 'none';
  syncedAt: string;
  /** 源表所在文档 / 子表，页尾标注数据来源用 */
  docUrl: string;
  sheetTitle: string;
  warnings: string[];
}
