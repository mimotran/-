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
  /** 淘宝搜索结果里的天猫商品 */
  isTmall?: boolean;
  /** 京东主站价格旁的标签，多为「到手价」 */
  priceLabel?: string;
  /** 京东主站的灰色划线价 */
  listedText?: string;
  /** 页面没显示店名，按自营 + 标题推断出来的 */
  shopInferred?: boolean;
  url: string;
}
