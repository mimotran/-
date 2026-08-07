'use client';

import { useId, useState } from 'react';

export interface TableColumn<T> {
  key: string;
  header: string;
  /** 数值列右对齐并用等宽字形 */
  numeric?: boolean;
  render: (row: T) => string;
  /**
   * 单元格文字颜色。只给状态列用 —— 文字通常穿文本色，
   * 这里的例外是「健康 / 需补货」这种本身就在表达好坏的状态，
   * 且颜色之外一定还有图标和文案，颜色从不单独承担含义。
   */
  color?: (row: T) => string;
}

/**
 * 每张图的表格孪生体。
 *
 * 不是可选项：色板里有几个色相在浅色底上低于 3:1 对比度，规范要求提供
 * 「视觉救济」——要么直标，要么表格。而且 tooltip 只能增强、不能垄断读数，
 * 键盘用户和读屏用户得有地方拿到同样的数字。
 */
export function TableView<T>({
  caption,
  columns,
  rows,
  defaultOpen = false,
}: {
  caption: string;
  columns: TableColumn<T>[];
  rows: T[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className="rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-wash)] hover:text-[var(--text-primary)]"
      >
        {open ? '收起数据表' : '查看数据表'}
      </button>

      {open && (
        <div id={id} className="mt-2 max-h-72 overflow-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0" style={{ background: 'var(--surface-1)' }}>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap border-b px-3 py-2 font-medium text-[var(--text-secondary)] ${
                      column.numeric ? 'text-right' : 'text-left'
                    }`}
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="hover:bg-[var(--hover-wash)]">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`whitespace-nowrap border-b px-3 py-1.5 ${
                        column.numeric ? 'tabular text-right' : 'text-left'
                      }`}
                      style={{
                        borderColor: 'var(--border)',
                        color: column.color?.(row) ?? 'var(--text-primary)',
                      }}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
