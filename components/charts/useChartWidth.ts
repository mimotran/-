'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 量出容器宽度，让 SVG 按真实像素画。
 *
 * 不用 preserveAspectRatio 缩放：那会把文字一起拉变形，
 * 坐标轴上的中文标签会糊成一片。
 */
export function useChartWidth(fallback = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && Math.abs(next - width) > 1) setWidth(next);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width || fallback);

    return () => observer.disconnect();
    // width 只作为去抖比较用，不参与订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  return [ref, width];
}
