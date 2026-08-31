import { useCallback, useEffect, useState } from 'react';
import { THEME_KEY } from '@/lib/config';

export type Theme = 'light' | 'dark';

function initial(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* private mode / blocked storage — fall through to the system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#060606' : '#f4eee2');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* the toggle still works for this session */
    }
  }, [theme]);

  // Follow the OS only while the user has not expressed a preference of their own.
  useEffect(() => {
    let explicit = false;
    try {
      explicit = localStorage.getItem(THEME_KEY) !== null;
    } catch {
      explicit = true;
    }
    if (explicit) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, toggle };
}
