import { isFeishuConfigured } from '@/lib/feishu/config';
import { syncFromFeishu } from '@/lib/feishu/sync';
import type { DashboardSnapshot } from '@/lib/types';
import { buildMockSnapshot } from './mock';
import { isFresh, readSnapshot, writeSnapshot } from './snapshot';

/**
 * 数据源解析顺序：
 *   1. 今天已经同步过的快照 —— 直接用
 *   2. 配了飞书 —— 现拉一次并落盘
 *   3. 有旧快照 —— 用旧的，并在页面上标注数据日期
 *   4. 都没有 —— mock 数据，页面顶部会明确标出「演示数据」
 */
export async function getSnapshot(options: { forceSync?: boolean } = {}): Promise<DashboardSnapshot> {
  const cached = options.forceSync ? null : await readSnapshot();
  if (cached && isFresh(cached)) return cached;

  if (isFeishuConfigured()) {
    try {
      const fresh = await syncFromFeishu();
      await writeSnapshot(fresh);
      return fresh;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (cached) {
        // 飞书挂了就先顶着旧数据，别让看板白屏
        return {
          ...cached,
          warnings: [`飞书同步失败，当前展示 ${cached.coverage.to} 的存量数据：${message}`, ...cached.warnings],
        };
      }
      const mock = buildMockSnapshot(today());
      return { ...mock, warnings: [`飞书同步失败，已回落到演示数据：${message}`] };
    }
  }

  if (cached) return cached;
  return buildMockSnapshot(today());
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
