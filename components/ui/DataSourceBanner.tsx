import { formatDateCn, formatSyncedAt } from '@/lib/format';
import type { DashboardSnapshot } from '@/lib/types';

const SOURCE_LABEL: Record<DashboardSnapshot['source'], string> = {
  'feishu-bitable': '飞书多维表格',
  'feishu-sheets': '飞书电子表格',
  mock: '演示数据',
};

/**
 * 数据来源与同步状态。
 *
 * 看板最怕的不是数字难看，是没人知道这份数字是什么时候的、来自哪里。
 * 用的是 mock 就明说是 mock —— 拿演示数据去开经营会是要出事的。
 */
export function DataSourceBanner({ snapshot }: { snapshot: DashboardSnapshot }) {
  const isMock = snapshot.source === 'mock';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: isMock ? 'var(--status-warning)' : 'var(--status-good)' }}
          />
          数据源 <span className="text-[var(--text-secondary)]">{SOURCE_LABEL[snapshot.source]}</span>
        </span>
        <span>
          最近同步 <span className="tabular">{formatSyncedAt(snapshot.syncedAt)}</span>
        </span>
        <span>
          覆盖 <span className="tabular">{formatDateCn(snapshot.coverage.from)}</span> 至{' '}
          <span className="tabular">{formatDateCn(snapshot.coverage.to)}</span>
        </span>
      </div>

      {isMock && (
        <p
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: 'var(--hover-wash)', color: 'var(--text-secondary)' }}
        >
          <span aria-hidden style={{ color: 'var(--status-warning)' }}>
            ■
          </span>{' '}
          当前展示的是<strong className="font-semibold text-[var(--text-primary)]">演示数据</strong>
          ，不是真实经营数据。在 <code className="tabular">.env.local</code> 里填好飞书应用凭证和文档
          token 后，看板会自动切换到真实数据。
        </p>
      )}

      {snapshot.warnings.length > 0 && (
        <details className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--hover-wash)' }}>
          <summary className="cursor-pointer text-[var(--text-secondary)]">
            <span aria-hidden style={{ color: 'var(--status-serious)' }}>
              ▲
            </span>{' '}
            同步告警 {snapshot.warnings.length} 条
          </summary>
          <ul className="mt-2 space-y-1 text-[var(--text-muted)]">
            {snapshot.warnings.map((warning, index) => (
              <li key={index}>· {warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
