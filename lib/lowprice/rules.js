/**
 * 低价链接监测 —— 口径、筛选、排序、聚合的**唯一实现**。
 *
 * 这个文件同时被两边用：
 *   · Node 侧（scripts/sync-links.ts、scripts/build-links.ts）import 它做自检和对账；
 *   · 浏览器侧由 scripts/build-links.ts 原样注入 preview/links.html 的 rules 块。
 *
 * 所以它必须是**不依赖任何模块、不碰 DOM 的纯 JS**：写成 .ts 就得有一份编译产物，
 * 页面里那份和 lib 里那份迟早会走样 —— 天猫看板的聚合逻辑在页面里重写过一遍，
 * 为此专门养了一套对账脚本。这次换个办法：干脆只留一份源码。
 *
 * 价格方向（最容易搞反的地方）：
 *   价差 = 官方指导价 − 发现价格        指导价 ¥1,399、发现价 ¥1,310 → 价差 +¥89
 *   低价幅度 = 价差 ÷ 官方指导价                                     → 6.36%
 * 因此「低价」是价差 > 0，不是 < 0。
 */

/** 低价幅度 ≥ 40% 视为疑似配件 / 定金 / 优惠券 / 抓取错误，标「异常价格」但**不剔除**统计 */
export const ABNORMAL_RATE = 0.4;

/**
 * 风险等级。rank 只用来排序，越大越严重；`min` 是**闭区间下界**，`max` 是开区间上界。
 * 边界归属：恰好 5% 算中度、恰好 10% 算高风险、恰好 20% 算严重。
 */
export const RISK_LEVELS = [
  { key: 'severe', label: '严重', rank: 4, min: 0.2, max: Infinity },
  { key: 'high', label: '高风险', rank: 3, min: 0.1, max: 0.2 },
  { key: 'medium', label: '中度', rank: 2, min: 0.05, max: 0.1 },
  { key: 'mild', label: '轻度', rank: 1, min: 0, max: 0.05 },
  { key: 'none', label: '非低价', rank: 0, min: -Infinity, max: 0 },
  /** 缺官方指导价或发现价格，算不出幅度。既不算低价也不算非低价，单独一档 */
  { key: 'unknown', label: '缺口径', rank: -1, min: NaN, max: NaN },
];

export const RISK_LABEL = RISK_LEVELS.reduce((acc, level) => {
  acc[level.key] = level.label;
  return acc;
}, /** @type {Record<string, string>} */ ({}));

const RISK_RANK = RISK_LEVELS.reduce((acc, level) => {
  acc[level.key] = level.rank;
  return acc;
}, /** @type {Record<string, number>} */ ({}));

/** 「低价程度」筛选项：和风险等级一一对应，不另起一套区间，免得两处口径漂移 */
export const BANDS = [
  { key: 'all', label: '全部' },
  { key: 'mild', label: '<5%' },
  { key: 'medium', label: '5%-10%' },
  { key: 'high', label: '10%-20%' },
  { key: 'severe', label: '>20%' },
];

/** 数值字段可能是 null（源表空着），统一收敛成 number | null，不要悄悄变成 0 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 官方指导价。必须 > 0，否则算幅度会除出 Infinity */
export function getListPrice(row) {
  const v = num(row && row.listPrice);
  return v !== null && v > 0 ? v : null;
}

/** 发现价格。允许 0（真有标 0 元的引流链接），但不允许负数 */
export function getPrice(row) {
  const v = num(row && row.price);
  return v !== null && v >= 0 ? v : null;
}

/** 价差（元）= 官方指导价 − 发现价格。算不出返回 null */
export function getPriceGap(row) {
  const list = getListPrice(row);
  const price = getPrice(row);
  if (list === null || price === null) return null;
  return list - price;
}

/** 低价幅度 = (官方指导价 − 发现价格) ÷ 官方指导价。算不出返回 null */
export function getDiscountRate(row) {
  const list = getListPrice(row);
  const price = getPrice(row);
  if (list === null || price === null) return null;
  return (list - price) / list;
}

/** 低价 = 发现价格 < 官方指导价。口径缺失时既不是低价也不是非低价，返回 false */
export function isLowPrice(row) {
  const rate = getDiscountRate(row);
  return rate !== null && rate > 0;
}

/** 风险等级 key，见 RISK_LEVELS */
export function getRiskLevel(row) {
  const rate = getDiscountRate(row);
  if (rate === null) return 'unknown';
  if (rate <= 0) return 'none';
  for (const level of RISK_LEVELS) {
    if (level.rank > 0 && rate >= level.min && rate < level.max) return level.key;
  }
  return 'none';
}

export function getRiskRank(row) {
  return RISK_RANK[getRiskLevel(row)] ?? 0;
}

/** 疑似异常价格（配件 / 定金 / 优惠券 / 抓取错误）。仍然计入低价统计，只是打标 */
export function isAbnormalPrice(row) {
  const rate = getDiscountRate(row);
  return rate !== null && rate >= ABNORMAL_RATE;
}

/**
 * 店铺唯一标识。
 *
 * 优先卖家 ID/UID —— 店铺名称会改、会撞名，同一家店在不同日期抓到的昵称也可能不一样。
 * 没有 ID 时退到「平台 + 卖家昵称」，仍然带上平台：淘宝和京东各有一家「XX数码专营店」很常见。
 */
export function getShopKey(row) {
  const platform = (row.platform || '').trim();
  const sellerId = (row.sellerId || '').trim();
  if (sellerId) return `${platform}::uid::${sellerId}`;
  return `${platform}::name::${(row.shop || '').trim()}`;
}

/**
 * 链接唯一标识。用于「同一条链接在多天被抓到」时的去重计数。
 * URL 带 ?spm= 之类的追踪参数，先削掉再比。
 */
export function getLinkKey(row) {
  const url = normalizeUrl(row.url);
  if (url) return `url::${url}`;
  return `fallback::${getShopKey(row)}::${row.model || ''}::${row.version || ''}`;
}

/**
 * 追踪参数黑名单。**不能**把整个 query 削掉 —— 淘宝 / 京东的商品 ID 就在 query 里
 * （item.htm?id=123），削了之后一家店所有链接会被当成同一条，去重计数直接塌掉。
 */
const TRACKING_PARAMS = new Set([
  'spm', 'scm', 'pvid', 'utparam', 'ut_sk', 'sourcetype', 'suid', 'shortlink',
  'share_crt_v', 'sp_tk', 'from', 'scene', 'clicktime', 'union_lens', 'ad_click',
  'extra_params', 'abbucket', 'app', 'channel', 'tk', 'bxsign', 'cpa', 'ptag',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
]);

/** 去掉 hash、追踪参数和末尾斜杠，剩下的参数排序后拼回去，让同一条链接的不同写法归一 */
export function normalizeUrl(raw) {
  const text = (raw || '').trim();
  if (!text) return '';
  const noHash = text.split('#')[0];
  const qi = noHash.indexOf('?');
  const base = (qi < 0 ? noHash : noHash.slice(0, qi)).replace(/\/+$/, '').toLowerCase();
  if (qi < 0) return base;

  const kept = [];
  for (const part of noHash.slice(qi + 1).split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).toLowerCase();
    if (TRACKING_PARAMS.has(key)) continue;
    kept.push(`${key}=${eq < 0 ? '' : part.slice(eq + 1)}`);
  }
  kept.sort();
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

/** 唯一值集合，按出现顺序去重后排序，用来生成筛选项 */
export function collectOptions(rows, field) {
  const seen = new Set();
  for (const row of rows) {
    const v = (row[field] || '').trim();
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** 数据源里的全部排查日期，升序 */
export function collectDates(rows) {
  const seen = new Set();
  for (const row of rows) if (row.date) seen.add(row.date);
  return [...seen].sort();
}

export function latestDate(rows) {
  const dates = collectDates(rows);
  return dates.length ? dates[dates.length - 1] : '';
}

/** 筛选条件的默认值。页面和自检脚本共用，省得两处各写一份默认 */
export function emptyFilters() {
  return {
    dateFrom: '',
    dateTo: '',
    platform: '',
    model: '',
    version: '',
    shopType: '',
    region: '',
    /** all | low | normal */
    lowPrice: 'all',
    /** all | mild | medium | high | severe */
    band: 'all',
    q: '',
  };
}

/**
 * 筛选。所有条件可组合，空值表示「全部」。
 *
 * 关键词搜索的范围按需求固定为：店铺名称 / 卖家 ID / 商品链接 / 备注。
 * 多个空格分隔的词是**与**关系 —— 「淘宝 999」应当只剩同时命中两者的行。
 */
export function applyFilters(rows, filters) {
  const f = { ...emptyFilters(), ...(filters || {}) };
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return rows.filter((row) => {
    if (f.dateFrom && row.date < f.dateFrom) return false;
    if (f.dateTo && row.date > f.dateTo) return false;
    if (f.platform && row.platform !== f.platform) return false;
    if (f.model && row.model !== f.model) return false;
    if (f.version && row.version !== f.version) return false;
    if (f.shopType && row.shopType !== f.shopType) return false;
    if (f.region && row.region !== f.region) return false;

    const low = isLowPrice(row);
    if (f.lowPrice === 'low' && !low) return false;
    if (f.lowPrice === 'normal' && low) return false;

    if (f.band !== 'all' && getRiskLevel(row) !== f.band) return false;

    if (terms.length) {
      const haystack = [row.shop, row.sellerId, row.url, row.note].join(' ').toLowerCase();
      for (const term of terms) if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

/**
 * 顶部五个指标。**全部**由当前筛选结果算出，页面上不许出现任何写死的汇总数字。
 *
 * 「在架链接」按记录条数算 —— 表格里有几行，这里就是几。选了日期区间时同一条链接
 * 会被抓到多次，所以另外给出去重后的链接数（links / lowLinks），页面在两者不等时
 * 显示一行小字说明，不在主数上做手脚。
 */
export function summarize(rows) {
  const linkKeys = new Set();
  const lowLinkKeys = new Set();
  const shopKeys = new Set();
  let low = 0;
  let severe = 0;
  let abnormal = 0;
  let unknown = 0;

  for (const row of rows) {
    linkKeys.add(getLinkKey(row));
    shopKeys.add(getShopKey(row));
    const level = getRiskLevel(row);
    if (level === 'unknown') unknown += 1;
    if (isLowPrice(row)) {
      low += 1;
      lowLinkKeys.add(getLinkKey(row));
      if (level === 'severe') severe += 1;
      if (isAbnormalPrice(row)) abnormal += 1;
    }
  }

  return {
    records: rows.length,
    links: linkKeys.size,
    low,
    lowLinks: lowLinkKeys.size,
    lowRate: rows.length ? low / rows.length : 0,
    shops: shopKeys.size,
    severe,
    abnormal,
    unknown,
  };
}

/** 各风险等级的条数，用于表头旁边的分布条 */
export function riskBreakdown(rows) {
  const counts = {};
  for (const level of RISK_LEVELS) counts[level.key] = 0;
  for (const row of rows) counts[getRiskLevel(row)] += 1;
  return counts;
}

/**
 * 排序。默认 `risk`：严重 → 高风险 → 中度 → 轻度 → 非低价，同级按低价幅度从高到低。
 * 其余字段排序时，同样拿低价幅度当次级键，免得一堆同值行每次渲染顺序都不一样。
 */
export function sortRows(rows, key = 'risk', dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  const rate = (row) => {
    const v = getDiscountRate(row);
    return v === null ? -Infinity : v;
  };
  const value = (row) => {
    switch (key) {
      case 'price':
        return getPrice(row) === null ? -Infinity : getPrice(row);
      case 'gap':
        return getPriceGap(row) === null ? -Infinity : getPriceGap(row);
      case 'rate':
        return rate(row);
      case 'sales':
        return typeof row.monthlySales === 'number' ? row.monthlySales : -Infinity;
      case 'date':
        return row.date || '';
      case 'risk':
      default:
        return getRiskRank(row);
    }
  };

  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va < vb) return -sign;
    if (va > vb) return sign;
    // 次级键固定按低价幅度降序，第三级用序号，保证顺序稳定
    const ra = rate(a);
    const rb = rate(b);
    if (ra !== rb) return rb - ra;
    return (a.seq || 0) - (b.seq || 0);
  });
}

/**
 * 按店铺聚合：同一家店的多条链接合成一行，用来找「整店大幅降价」的异常店铺。
 * 排序口径 = 低价链接数优先，其次最大低价幅度 —— 一家店 8 条链接全在降，
 * 比另一家只有 1 条降得更狠更值得先看。
 */
export function aggregateShops(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = getShopKey(row);
    let shop = map.get(key);
    if (!shop) {
      shop = {
        key,
        shop: row.shop || '(未命名店铺)',
        sellerId: row.sellerId || '',
        platform: row.platform || '',
        shopType: row.shopType || '',
        shopUrl: row.shopUrl || '',
        records: 0,
        low: 0,
        severe: 0,
        maxRate: null,
        minPrice: null,
        models: new Set(),
        latest: '',
      };
      map.set(key, shop);
    }
    shop.records += 1;
    if (!shop.shopUrl && row.shopUrl) shop.shopUrl = row.shopUrl;
    if (!shop.shopType && row.shopType) shop.shopType = row.shopType;
    if (row.model) shop.models.add(row.model);
    if (row.date > shop.latest) shop.latest = row.date;

    const rate = getDiscountRate(row);
    const price = getPrice(row);
    if (isLowPrice(row)) {
      shop.low += 1;
      if (getRiskLevel(row) === 'severe') shop.severe += 1;
      if (rate !== null && (shop.maxRate === null || rate > shop.maxRate)) shop.maxRate = rate;
      if (price !== null && (shop.minPrice === null || price < shop.minPrice)) shop.minPrice = price;
    }
  }

  return [...map.values()]
    .map((shop) => ({ ...shop, models: [...shop.models] }))
    .sort(
      (a, b) =>
        b.low - a.low ||
        (b.maxRate ?? -1) - (a.maxRate ?? -1) ||
        b.records - a.records ||
        a.shop.localeCompare(b.shop, 'zh-Hans-CN'),
    );
}
