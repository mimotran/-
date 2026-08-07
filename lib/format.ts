import type { KpiValue } from './types';

/** 数字格式化：中文电商场景习惯用「万 / 亿」，而不是 K/M */

/**
 * 万 / 亿 压缩。
 *
 * 位数按压缩后的大小定：1.05 万只保留一位就成了「1万」，直接吃掉 5% 的差异，
 * 所以个位数的量级留两位小数，两位数以上留一位。
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${trim(value / 1e8, abs < 1e9 ? 2 : 1)}亿`;
  if (abs >= 1e4) return `${trim(value / 1e4, abs < 1e5 ? 2 : 1)}万`;
  return abs >= 1000
    ? Math.round(value).toLocaleString('zh-CN')
    : trim(value, abs >= 100 ? 0 : 1);
}

export function formatCurrency(value: number): string {
  return `¥${formatCompact(value)}`;
}

/**
 * 计数类指标。
 *
 * 十万以下不压缩 —— 10,009 压成「1万」等于把一万零九和一万整说成同一个数，
 * 而订单数正是最需要看准的那类指标。到十万以上再压，「42.3万」的相对误差可以接受。
 */
export function formatInteger(value: number): string {
  return Math.abs(value) >= 1e5
    ? formatCompact(value)
    : Math.round(value).toLocaleString('zh-CN');
}

export function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDecimal(value: number, digits = 2): string {
  return value.toFixed(digits);
}

export function formatByKind(value: number, format: KpiValue['format']): string {
  switch (format) {
    case 'currency':
      return formatCurrency(value);
    case 'integer':
      return formatInteger(value);
    case 'percent':
      return formatPercent(value);
    case 'decimal':
      return formatDecimal(value);
  }
}

/** 精确值，给表格视图和 tooltip 用（不做万/亿压缩） */
export function formatExact(value: number, format: KpiValue['format']): string {
  switch (format) {
    case 'currency':
      return `¥${Math.round(value).toLocaleString('zh-CN')}`;
    case 'integer':
      return Math.round(value).toLocaleString('zh-CN');
    case 'percent':
      return formatPercent(value);
    case 'decimal':
      return formatDecimal(value);
  }
}

/** 变化率带符号，null 显示为「—」 */
export function formatDelta(rate: number | null, digits = 1): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  const sign = rate > 0 ? '+' : '';
  return `${sign}${(rate * 100).toFixed(digits)}%`;
}

/** 变化率的绝对值：方向已经由箭头表达时用这个，避免「↓-18.1%」这种双重否定 */
export function formatDeltaMagnitude(rate: number, digits = 1): string {
  return `${(Math.abs(rate) * 100).toFixed(digits)}%`;
}

/**
 * 按可用像素宽截断标签。
 *
 * 中文字符约占一个字宽、拉丁字符约半个，混排时按纯字数截会让
 * 「录音笔 Note Pro 旗舰版」和「录音笔 Note Air 轻薄款」截成同一串，
 * 排行榜上就分不出是哪个单品了。
 */
export function truncateToWidth(text: string, pixels: number, fontSize = 12): string {
  const budget = pixels / fontSize;
  const widthOf = (char: string) => (/[⺀-￯]/.test(char) ? 1 : 0.55);

  let used = 0;
  for (let i = 0; i < text.length; i++) {
    used += widthOf(text[i]);
    if (used > budget) {
      // 留出省略号的位置
      let cut = i;
      let back = 0;
      while (cut > 0 && back < 1) {
        cut -= 1;
        back += widthOf(text[cut]);
      }
      return `${text.slice(0, Math.max(1, cut))}…`;
    }
  }
  return text;
}

/** 月-日，坐标轴用 */
export function formatDayShort(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function formatDateCn(date: string): string {
  const [year, month, day] = date.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

export function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function trim(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  // 去掉 12.0 这种没意义的小数尾巴
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
