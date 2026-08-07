'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' };
const ICON: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' };

/**
 * 明暗切换。深色不是浅色的自动反转 —— 色板在深色底上是另取的一组步进值，
 * 两套都单独过了对比度和色弱校验，这里只负责在 <html> 上打标记。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    if (next === 'system') {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem('theme');
    } else {
      document.documentElement.dataset.theme = next;
      localStorage.setItem('theme', next);
    }
  }

  return (
    <button
      type="button"
      onClick={() => apply(NEXT[theme])}
      className="rounded-lg border px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-wash)] hover:text-[var(--text-primary)]"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      title={`当前：${LABEL[theme]}，点击切换到${LABEL[NEXT[theme]]}`}
    >
      <span aria-hidden className="mr-1.5">
        {ICON[theme]}
      </span>
      {LABEL[theme]}
    </button>
  );
}
