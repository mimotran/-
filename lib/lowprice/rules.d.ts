/**
 * rules.js 的类型声明。
 *
 * 实现故意写成纯 JS（见 rules.js 开头的说明）：它要被原样注入到静态页面里，
 * 有编译步骤就会出现「页面里那份」和「lib 里那份」两份代码。
 * 类型单独放在这里，TS 侧照样有完整签名。
 */

import type { LinkFilters, LinkRecord, LinkSummary, ShopAggregate } from './types';

export type RiskKey = 'severe' | 'high' | 'medium' | 'mild' | 'none' | 'unknown';
export type BandKey = 'all' | 'mild' | 'medium' | 'high' | 'severe';

export interface RiskLevel {
  key: RiskKey;
  label: string;
  rank: number;
  min: number;
  max: number;
}

export const ABNORMAL_RATE: number;
export const RISK_LEVELS: RiskLevel[];
export const RISK_LABEL: Record<RiskKey, string>;
export const BANDS: Array<{ key: BandKey; label: string }>;

export function getListPrice(row: LinkRecord): number | null;
export function getPrice(row: LinkRecord): number | null;
export function getPriceGap(row: LinkRecord): number | null;
export function getDiscountRate(row: LinkRecord): number | null;
export function isLowPrice(row: LinkRecord): boolean;
export function getRiskLevel(row: LinkRecord): RiskKey;
export function getRiskRank(row: LinkRecord): number;
export function isAbnormalPrice(row: LinkRecord): boolean;
export function getShopKey(row: LinkRecord): string;
export function getLinkKey(row: LinkRecord): string;
export function normalizeUrl(raw: string): string;
export function collectOptions(rows: LinkRecord[], field: keyof LinkRecord): string[];
export function collectDates(rows: LinkRecord[]): string[];
export function latestDate(rows: LinkRecord[]): string;
export function emptyFilters(): LinkFilters;
export function applyFilters(rows: LinkRecord[], filters: Partial<LinkFilters>): LinkRecord[];
export function summarize(rows: LinkRecord[]): LinkSummary;
export function riskBreakdown(rows: LinkRecord[]): Record<RiskKey, number>;
export function sortRows(
  rows: LinkRecord[],
  key?: 'risk' | 'price' | 'gap' | 'rate' | 'sales' | 'date',
  dir?: 'asc' | 'desc',
): LinkRecord[];
export function aggregateShops(rows: LinkRecord[]): ShopAggregate[];

export interface TrendPoint extends LinkSummary {
  date: string;
  risk: Record<RiskKey, number>;
}
export interface DistributionRow {
  key: string;
  parts: string[];
  records: number;
  low: number;
  lowRate: number;
  severe: number;
}
export interface BreakdownRow {
  key: string;
  records: number;
  low: number;
  lowRate: number;
  severe: number;
}

export function trendSeries(rows: LinkRecord[]): TrendPoint[];
export function delta(current: number, previous: number | null | undefined): { abs: number; pct: number | null } | null;
export function latestPerLink(rows: LinkRecord[]): LinkRecord[];
export function distribution(rows: LinkRecord[], fields?: Array<keyof LinkRecord>): DistributionRow[];
export function breakdownBy(rows: LinkRecord[], field: keyof LinkRecord): BreakdownRow[];
export function previousRange(
  dates: string[],
  from: string,
  to: string,
): { from: string; to: string } | null;
export function lastPeriods(dates: string[], n: number): { from: string; to: string };
