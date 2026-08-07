/**
 * 迷你走势条。
 *
 * 整条线走弱化色，最后一段用强调色 —— 眼睛先落在「现在」上，前面的历史是背景板。
 * 不画坐标轴、不标数值，具体值在卡片主数字和数据表里。
 *
 * 用 preserveAspectRatio="none" 横向铺满容器，配合 vector-effect 让线宽不跟着拉伸；
 * 这样卡片再窄也不会溢出，比固定像素宽度稳。
 */
export function Sparkline({ values, height = 28 }: { values: number[]; height?: number }) {
  if (values.length < 2) return <div style={{ height }} aria-hidden />;

  const W = 100;
  const H = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = W / (values.length - 1);
  // 上下各留 3px，线的圆头不会被裁掉
  const y = (value: number) => H - 3 - ((value - min) / span) * (H - 6);

  const points = values.map((value, index) => [index * step, y(value)] as const);
  const toPath = (list: ReadonlyArray<readonly [number, number]>) =>
    list.map(([x, py], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${py.toFixed(2)}`).join('');

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className="block"
    >
      <path
        d={toPath(points)}
        fill="none"
        stroke="var(--series-muted)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* 最后一段用强调色标出「当前」 */}
      <path
        d={toPath(points.slice(-2))}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
