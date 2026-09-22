/** 搜索页解析出来的一张商品卡，还没做型号/版本判定 */
export interface RawItem {
  platform: '淘宝' | '京东';
  id: string;
  title: string;
  price: number | null;
  /** 淘宝的「82人付款」原文；京东没有月销，这里留空 */
  salesText: string;
  /** 京东的累计评价热度（1万+ / 500+），淘宝留空 */
  heatText?: string;
  region: string;
  shop: string;
  /** 京东自营 */
  isSelfRun?: boolean;
  /** 直通车 / 广告位 */
  isAd?: boolean;
  url: string;
}
