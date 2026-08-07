import type { ReactNode } from 'react';

/** 看板的基础容器：发丝线描边 + 图表表面色，分区靠留白而不是粗边框 */
export function Card({
  title,
  hint,
  actions,
  children,
  className = '',
}: {
  title?: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border p-4 sm:p-5 ${className}`}
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>}
            {hint && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** 板块标题：比卡片标题高一级，用于「销售概览」这类大分区 */
export function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-base font-semibold text-[var(--text-primary)]">
        {title}
      </h2>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}
