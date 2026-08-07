const SECTIONS = [
  { id: 'goal-attainment', label: '目标达成' },
  { id: 'store-overview', label: '店铺整体' },
  { id: 'insite-ads', label: '站内投放' },
  { id: 'offsite-ads', label: '站外投放' },
  { id: 'product', label: '产品' },
  { id: 'traffic', label: '流量' },
];

/**
 * 板块跳转。
 *
 * 六个板块 × 每个三档周期，整页很长，没有导航就只能靠滚。
 * 用锚点而不是 tab —— 板块之间需要互相印证（看到投放费涨了会立刻想回去看 GMV），
 * tab 会把这个动作变成来回切换。
 */
export function SectionNav() {
  return (
    <nav aria-label="板块导航" className="flex flex-wrap gap-1">
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="rounded-md border px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-wash)] hover:text-[var(--text-primary)]"
          style={{ borderColor: 'var(--border)' }}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
