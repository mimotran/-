/**
 * 飞书表头 → 看板字段的映射。
 *
 * 每个字段准备一组别名，按顺序匹配第一个命中的列。表头改了只需要在这里加一个
 * 别名，不用动其它代码。
 *
 * **别名的第一项是真实表头**（取自「Y26 Plaud天猫渠道日报」的实际列名），
 * 后面几项是同义写法兜底。等飞书权限开通后跑 `npm run headers` 核对一遍 ——
 * 现在这份是照着表格截图对的，行列结构（表头在第几行、汇总段和明细段怎么切）
 * 还没有验证过。
 */

/** 别名表。键既包括看板字段，也包括「客退率」这类用于推算的辅助列 */
export type AliasMap = Record<string, readonly string[]>;

/**
 * 店铺日报。
 *
 * 有几个字段表里给的是**比率**而不是绝对值（新客率、客退率、站内 ROI），
 * 解析时用它们乘 / 除出绝对值 —— 模型里存可加的量，比率一律聚合后再算。
 */
export const DAILY_ALIASES: AliasMap = {
  date: ['日期', '时间', '统计日期', '日明细', 'date'],
  gmv: ['GMV', '支付金额', '成交金额', '支付GMV', '销售额', 'gmv'],
  deviceSales: ['主机销量', '主机', '销量', '设备销量', 'deviceSales'],
  gmvAfterRefund: ['退后GMV', '退后成交', '净GMV', 'gmvAfterRefund'],
  refund: ['退款金额', '成功退款金额', '退款', 'refund'],
  uv: ['UV', '访客数', '商品访客数', 'uv'],
  searchUv: ['搜索UV', '搜索访客数', '搜索流量', 'searchUv'],
  buyers: ['支付人数', '支付买家数', '成交人数', '买家数', 'buyers'],
  orders: ['支付订单数', '成交订单数', '订单数', 'orders'],
  addToCart: ['加购人数', '加购件数', '加购数', 'addToCart'],
  adCost: ['投放费', '推广花费', '广告花费', '花费', 'adCost'],
  adCostInsite: ['站内消耗', '站内投放费', '站内花费', 'adCostInsite'],
  adCostOffsite: ['站外消耗', '站外投放费', '站外花费', 'adCostOffsite'],

  // --- 辅助列：用来推算绝对值，本身不进数据模型 ---
  /** 客退率 / 退款率：没有「退款金额」列时用它乘 GMV 反推 */
  refundRate: ['客退率', '退款率', '退货率', 'refundRate'],
  /** 新客率：乘 GMV 得到新客成交额 */
  newCustomerRate: ['新客率', '新客占比', 'newCustomerRate'],
  /** 新客成交额：有这一列就直接用，优先于新客率 */
  newCustomerGmv: ['新客成交', '新客GMV', '新客支付金额', 'newCustomerGmv'],
  /** 站内 ROI：乘站内消耗得到站内成交 */
  roiInsite: ['站内ROI', '站内roi', 'roiInsite'],
  roiOffsite: ['站外ROI', '站外roi', 'roiOffsite'],
  /** 站内 / 站外成交额：有就直接用，优先于 ROI 反推 */
  adGmvInsite: ['站内成交', '站内成交金额', 'adGmvInsite'],
  adGmvOffsite: ['站外成交', '站外成交金额', 'adGmvOffsite'],
  /** 站内费比：没有「站内消耗」列时用它乘 GMV 反推 */
  adCostRateInsite: ['站内费比', '站内投放费率', 'adCostRateInsite'],
  adCostRateOffsite: ['站外费比', '站外投放费率', 'adCostRateOffsite'],
  /** 搜索订单数 / 搜索转化率：算搜索转化率用，两者有其一即可 */
  searchOrders: ['搜索订单数', '搜索成交订单数', 'searchOrders'],
  searchConversionRate: ['搜索转化率', '搜索支付转化率', 'searchConversionRate'],
  /** 搜索成交金额：没有这一列时用「搜索UV价值 × 搜索UV」或「成交占比 × GMV」反推 */
  searchGmv: ['搜索成交', '搜索成交金额', '搜索GMV', 'searchGmv'],
  searchUvValue: ['搜索UV价值', 'searchUvValue'],
  searchGmvShare: ['搜索成交占比', '成交占比', 'searchGmvShare'],
  /** 付费流量 UV：没有这一列时用「付费UV占比 × 总UV」反推 */
  paidUv: ['付费UV', '付费流量UV', '总付费流量UV', 'paidUv'],
  paidUvShare: ['付费UV占比', 'UV占比', 'paidUvShare'],
  /** 利润：有绝对值用绝对值，没有就用利润率乘 GMV */
  grossProfit: ['利润', '预估利润', '毛利', '销售利润', 'grossProfit'],
  profitRate: ['利润率', '销售利润率', '毛利率', 'profitRate'],
};

/**
 * 目标表的列名。
 *
 * 键必须和 lib/metrics.ts 里 GOAL_METRICS 的 key 一一对应 —— 目标表一行一个周期、
 * 一列一个指标，缺哪列就哪个指标没有目标，页面上显示「—」而不是当成 0。
 */
export const TARGET_METRIC_ALIASES: AliasMap = {
  gmv: ['GMV目标', 'GMV', '目标GMV', '销售目标', 'gmv'],
  deviceSales: ['销量目标', '主机销量目标', '主机目标', '销量', 'deviceSales'],
  refundRate: ['退款率目标', '客退率目标', '退款率', 'refundRate'],
  adCostInsite: ['站内投放费目标', '站内消耗目标', '站内投放费', 'adCostInsite'],
  roiInsite: ['站内ROI目标', '站内ROI', 'roiInsite'],
  adCostRateInsite: ['站内费比目标', '站内费比', 'adCostRateInsite'],
  adCostOffsite: ['站外投放费目标', '站外消耗目标', '站外投放费', 'adCostOffsite'],
  roiOffsite: ['站外ROI目标', '站外ROI', 'roiOffsite'],
  adCostRateOffsite: ['站外费比目标', '站外费比', 'adCostRateOffsite'],
  adCost: ['总投放费目标', '投放费目标', '总投放费', 'adCost'],
  adCostRate: ['总费比目标', '总费比', '投放费率目标', 'adCostRate'],
  grossProfit: ['利润目标', '预估利润目标', '利润', 'grossProfit'],
  profitRate: ['利润率目标', '利润率', 'profitRate'],
  searchUv: ['搜索UV目标', '搜索UV', 'searchUv'],
  searchConversionRate: ['搜索转化率目标', '搜索转化率', 'searchConversionRate'],
};

/** 投放明细：站内按触点、站外按渠道，两张表结构一致 */
export const AD_ALIASES: AliasMap = {
  date: ['日期', '时间', '统计日期', 'date'],
  channel: ['触点', '渠道', '资源位', '推广方式', '广告类型', '媒体', 'channel'],
  cost: ['投放费', '消耗', 'SPD', '花费', '成本', 'cost'],
  gmv: ['成交金额', '成交', 'Sales', 'GMV', '支付金额', 'gmv'],
  orders: ['订单数', '成交订单数', 'Order', 'Orders', 'orders'],
  impressions: ['曝光量', '展现量', '曝光', 'impressions'],
  clicks: ['点击量', '点击数', '点击', 'clicks'],
  /** CVR：没有订单数列时用它乘点击量反推 */
  cvr: ['CVR', 'cvr', '转化率', '点击转化率'],
  /** ROI：没有「成交金额」列时用它乘投放费反推 */
  roi: ['ROI', 'roi', '投产比'],
  /** 有些表把站内 / 站外放在同一张表里，用这一列区分 */
  scope: ['投放类型', '站内站外', '类型', 'scope'],
};

export const PRODUCT_ALIASES: AliasMap = {
  date: ['日期', '时间', '统计日期', 'date'],
  itemId: ['商品ID', '宝贝ID', '链接ID', '商品 ID', 'itemId'],
  title: ['商品名称', '宝贝标题', '商品标题', '链接名称', 'title'],
  line: ['产品线', '品类', '系列', '类目', 'line'],
  gmv: ['GMV', '支付金额', '成交金额', 'gmv'],
  quantity: ['销量', '支付件数', '成交件数', 'quantity'],
  uv: ['UV', '访客数', '商品访客数', 'uv'],
  refund: ['退款金额', '退款', 'refund'],
};

export const KEYWORD_ALIASES: AliasMap = {
  date: ['日期', '时间', '统计日期', 'date'],
  keyword: ['关键词', '搜索词', '词', 'keyword'],
  /** 词性：表里没有这一列时按 BRAND_PATTERNS 从词本身判 */
  group: ['词性', '词类', '分组', '类型', 'group'],
  uv: ['搜索UV', 'UV', '访客数', '搜索人数', 'uv'],
  gmv: ['成交金额', 'GMV', '支付金额', 'gmv'],
  orders: ['订单数', '支付订单数', '成交订单数', 'orders'],
};

/** 目标表里定位「哪个周期」的那一列 */
export const TARGET_ALIASES: AliasMap = {
  key: ['月份', '周期', '时间', '日期', 'key'],
};

/**
 * 产品线归类。
 *
 * 表里大概率没有「产品线」这一列，得从商品标题里认 ——
 * 顺序有讲究：Pro 要在 NOTE 之前判，否则「NOTE Pro」会被 NOTE 先吃掉。
 */
export const LINE_PATTERNS: Array<{ line: string; test: RegExp }> = [
  { line: 'member', test: /会员|年卡|季卡|月卡|订阅/i },
  { line: 'accessory', test: /配件|保护套|挂绳|底座|充电|延保|贴膜/i },
  { line: 'pro', test: /pro|旗舰/i },
  { line: 'pins', test: /pin|挂坠|胸针/i },
  { line: 'note', test: /note|录音笔|卡片/i },
];

/** 表头归一化：去空格、全角括号转半角、去掉单位后缀，提升匹配命中率 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
    .replace(/\((元|人|件|次|台|%)\)$/, '')
    .toLowerCase();
}

/**
 * 拿真实表头跑一遍别名表，看每个字段落到哪一列。
 *
 * `npm run headers` 用它输出对齐报告：column 为 null 的字段在表里没有对应列，
 * 解析时会静默取 0 —— 看板上就是一片「0」，而不是报错，所以对齐必须靠这个显式检查。
 */
export interface HeaderMatch {
  field: string;
  /** 命中的真实列名；没有任何别名命中时为 null */
  column: string | null;
}

export function matchHeaders(headers: string[], aliases: AliasMap): HeaderMatch[] {
  const index = new Map<string, string>();
  for (const header of headers) {
    const key = normalizeHeader(header);
    // 同名列只认第一个，和 pick 的行为保持一致
    if (!index.has(key)) index.set(key, header);
  }

  return Object.keys(aliases).map((field) => {
    for (const alias of aliases[field]) {
      const hit = index.get(normalizeHeader(alias));
      if (hit !== undefined) return { field, column: hit };
    }
    return { field, column: null };
  });
}

/** 在一行记录里按别名找值 */
export function pick(row: Record<string, unknown>, aliases: readonly string[] | undefined): unknown {
  if (!aliases) return undefined;
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    const norm = normalizeHeader(key);
    if (!normalized.has(norm)) normalized.set(norm, value);
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
  const cleaned = raw.replace(/[,，\s¥￥$元件人次台%]/g, '');
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
 * 支持多维表格的毫秒时间戳、Excel 序列号，以及 2026/8/7、20260807、8月7日 等写法。
 *
 * `defaultYear` 给「7月1日」这种不带年份的写法用 —— 日报表里很常见，
 * 不给年份的话会全部落到今年，跨年数据就串了。
 */
export function toDate(value: unknown, defaultYear?: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return toDate(value[0], defaultYear);
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; value?: unknown };
    if (obj.text !== undefined) return toDate(obj.text, defaultYear);
    if (obj.value !== undefined) return toDate(obj.value, defaultYear);
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
    const y = cn[1] ?? String(defaultYear ?? new Date().getUTCFullYear());
    return `${y}-${pad(cn[2])}-${pad(cn[3])}`;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : fromTimestamp(parsed);
}

/** 月份键：`2026-08`。目标表里「8月」「2026/8」「2026-08」都有人写 */
export function toMonthKey(value: unknown, defaultYear?: number): string | null {
  const text = toText(value);
  if (!text) return null;

  const full = text.match(/^(\d{4})[-/.年]?(\d{1,2})月?$/);
  if (full) return `${full[1]}-${pad(full[2])}`;

  const monthOnly = text.match(/^(\d{1,2})月$/);
  if (monthOnly && defaultYear) return `${defaultYear}-${pad(monthOnly[1])}`;

  const date = toDate(value, defaultYear);
  return date ? date.slice(0, 7) : null;
}

function fromTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pad(value: string | number): string {
  return String(value).padStart(2, '0');
}
