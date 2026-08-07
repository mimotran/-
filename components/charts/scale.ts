/** 图表通用的刻度与比例尺工具 */

/** 生成「好看」的刻度：1 / 2 / 2.5 / 5 的整数倍 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;

  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  // 顶部至少要盖住最大值
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(10)));
  return ticks;
}

export interface LinearScale {
  (value: number): number;
  domainMax: number;
}

export function linearScale(domainMax: number, rangeFrom: number, rangeTo: number): LinearScale {
  const span = domainMax > 0 ? domainMax : 1;
  const scale = ((value: number) => rangeTo + ((rangeFrom - rangeTo) * value) / span) as LinearScale;
  scale.domainMax = span;
  return scale;
}

/** 均匀分布的横轴位置（点在带的中心） */
export function bandCenters(count: number, from: number, to: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(from + to) / 2];
  const width = (to - from) / count;
  return Array.from({ length: count }, (_, i) => from + width * (i + 0.5));
}

/**
 * 横轴标签抽稀：点太多时只显示若干个，避免文字叠在一起。
 * 返回需要显示标签的索引集合，首尾一定保留。
 */
export function thinLabels(count: number, maxLabels: number): Set<number> {
  const keep = new Set<number>();
  if (count === 0) return keep;
  if (count <= maxLabels) {
    for (let i = 0; i < count; i++) keep.add(i);
    return keep;
  }
  const step = (count - 1) / (maxLabels - 1);
  for (let i = 0; i < maxLabels; i++) keep.add(Math.round(i * step));
  return keep;
}

/** 折线路径，null 值会断开线段而不是连成直线 */
export function linePath(xs: number[], ys: Array<number | null>): string {
  let path = '';
  let penDown = false;
  ys.forEach((y, i) => {
    if (y === null) {
      penDown = false;
      return;
    }
    path += `${penDown ? 'L' : 'M'}${xs[i].toFixed(2)},${y.toFixed(2)}`;
    penDown = true;
  });
  return path;
}

/** 顶端 4px 圆角、底端贴基线方角的柱子路径 */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (height <= 0) return '';
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    'Z',
  ].join('');
}

/** 横向条：右端 4px 圆角，左端贴基线方角 */
export function hBarPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, height / 2, width));
  if (width <= 0) return '';
  return [
    `M${x},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height - r}`,
    `Q${x + width},${y + height} ${x + width - r},${y + height}`,
    `L${x},${y + height}`,
    'Z',
  ].join('');
}
