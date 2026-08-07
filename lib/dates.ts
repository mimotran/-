import type { DateStr, DateRange } from './types';

/**
 * 日期工具。
 *
 * 全部按 UTC 算 —— 用本地时区的话，同一份数据在不同时区的机器上会算出不同的
 * 「昨日」和「本月」，Vercel 的服务器和运营的电脑就对不上了。
 */

export function parseDate(date: DateStr): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function toDateStr(date: Date): DateStr {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: DateStr, days: number): DateStr {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return toDateStr(next);
}

/** 相差天数（b − a） */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

export function year(date: DateStr): number {
  return Number(date.slice(0, 4));
}

export function month(date: DateStr): number {
  return Number(date.slice(5, 7));
}

export function dayOfMonth(date: DateStr): number {
  return Number(date.slice(8, 10));
}

/** `2026-08` 形式的月份键 */
export function monthKey(date: DateStr): string {
  return date.slice(0, 7);
}

export function startOfMonth(date: DateStr): DateStr {
  return `${monthKey(date)}-01`;
}

export function startOfYear(date: DateStr): DateStr {
  return `${date.slice(0, 4)}-01-01`;
}

export function endOfMonth(date: DateStr): DateStr {
  const d = parseDate(date);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return toDateStr(d);
}

export function daysInMonth(date: DateStr): number {
  return dayOfMonth(endOfMonth(date));
}

/**
 * 往前推 N 个月，保持「日」不变。
 * 目标日在短月里不存在时（3 月 31 日 → 2 月）落到该月最后一天。
 */
export function addMonths(date: DateStr, months: number): DateStr {
  const d = parseDate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = daysInMonth(toDateStr(d));
  d.setUTCDate(Math.min(day, last));
  return toDateStr(d);
}

/** 往前推一年。2 月 29 日会落到 2 月 28 日 */
export function addYears(date: DateStr, years: number): DateStr {
  return addMonths(date, years * 12);
}

/** 闭区间内的每一天 */
export function eachDay(range: DateRange): DateStr[] {
  const days: DateStr[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);
  return days;
}

export function inRange(date: DateStr, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** 区间天数（闭区间，含首尾） */
export function rangeLength(range: DateRange): number {
  return diffDays(range.from, range.to) + 1;
}

/** 季度序号 1–4 */
export function quarterOf(date: DateStr): number {
  return Math.floor((month(date) - 1) / 3) + 1;
}

/** 上半年 / 下半年 */
export function halfOf(date: DateStr): 1 | 2 {
  return month(date) <= 6 ? 1 : 2;
}
