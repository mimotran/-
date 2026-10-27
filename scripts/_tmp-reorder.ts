// 把某个排查日期的整批行按「淘宝在前、京东在后」重排，序号按新顺序重编。
// 只重写这一段的值；写之前留一份原样快照，写完逐行比对（除序号外每格都要一致）。
import { writeFileSync } from 'node:fs';
import { feishuGet, feishuPut } from '../lib/feishu/client';
import { loadFeishuConfig } from '../lib/feishu/config';
const T = 'YEDVs46o2hzZ8htBnakcbzNpnrp'; const cfg = loadFeishuConfig();
const t = (c: unknown): string => Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? '').join('') : c == null ? '' : String(c).trim();
// 读回来的超链接是 [{type:'url', text, link}] 数组，写入要单个对象
const toWrite = (c: unknown): unknown => {
  if (Array.isArray(c)) {
    const l = c.find((x) => (x as { link?: string }).link) as { link?: string; text?: string } | undefined;
    if (l?.link) return { type: 'url', text: t(c) || l.link, link: l.link };
    return t(c);
  }
  return c ?? '';
};
const key = (r: unknown[]) => r.slice(1).map((c) => (Array.isArray(c) ? JSON.stringify((c.find((x) => (x as { link?: string }).link) as { link?: string })?.link ?? t(c)) : t(c))).join('\u0001');
async function read() {
  const d = await feishuGet<{ valueRange: { values: unknown[][] } }>(`/sheets/v2/spreadsheets/${T}/values/${encodeURIComponent('1WDztC!A1:Q20000')}`, {}, cfg);
  const v = d.valueRange.values; let n = v.length; while (n > 0 && v[n - 1].every((c) => t(c) === '')) n--; return v.slice(0, n);
}
async function main() {
  const [date, snap, go] = [process.argv[2], process.argv[3], process.argv.includes('--go')];
  const g = await read(); const h = g[0].map(t); const c = (n: string) => h.indexOf(n);
  const idx = g.map((r, i) => [i + 1, r] as const).filter(([, r]) => t(r[c('排查日期')]) === date);
  const nums = idx.map(([n]) => n);
  if (!nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) throw new Error('这批行不连续，停止');
  const rows = idx.map(([, r]) => r);
  const order = (p: string) => (p === '淘宝' ? 0 : p === '京东' ? 1 : 2);
  const sorted = rows.map((r, i) => [r, i] as const).sort((a, b) => order(t(a[0][c('平台')])) - order(t(b[0][c('平台')])) || a[1] - b[1]).map(([r]) => r);
  const seq0 = Math.min(...rows.map((r) => Number(t(r[0])) || Infinity));
  const out = sorted.map((r, i) => { const w = r.slice(0, 17).map(toWrite); w[0] = seq0 + i; return w; });
  writeFileSync(snap, JSON.stringify({ first: nums[0], rows }, null, 1));
  const plats = sorted.map((r) => t(r[c('平台')]));
  console.log(`第 ${nums[0]}–${nums[nums.length - 1]} 行，共 ${rows.length} 行；重排后：淘宝 ${plats.filter((p) => p === '淘宝').length} 行在前（第 ${nums[0]}–${nums[0] + plats.lastIndexOf('淘宝')} 行），京东 ${plats.filter((p) => p === '京东').length} 行在后；序号 ${seq0}–${seq0 + rows.length - 1}`);
  if (!go) return;
  await feishuPut(`/sheets/v2/spreadsheets/${T}/values`, { valueRange: { range: `1WDztC!A${nums[0]}:Q${nums[nums.length - 1]}`, values: out } }, cfg);
  const after = (await read()).slice(nums[0] - 1, nums[nums.length - 1]);
  const bad = after.filter((r, i) => key(r) !== key(sorted[i])).length;
  const seqOk = after.every((r, i) => Number(t(r[0])) === seq0 + i);
  console.log(`✓ 已写回。逐行比对：内容不一致 ${bad} 行；序号连续 ${seqOk}；原样快照 ${snap}`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
