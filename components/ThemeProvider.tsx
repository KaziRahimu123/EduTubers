'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getSession, getTheme, saveTheme as persistTheme } from '@/lib/auth';
import type { Theme } from '@/lib/auth';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemDark(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && getSystemDark());
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');

  // On mount: load saved theme and apply it
  useEffect(() => {
    const session = getSession();
    const saved: Theme = session
      ? getTheme(session.username)
      : (localStorage.getItem('be_theme') as Theme | null) ?? 'system';
    setThemeState(saved);
    applyTheme(saved);
  }, []);

  // React to OS-level dark/light changes when theme is 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      // Read the current theme from the DOM to avoid stale closure
      const current = (localStorage.getItem('be_theme') as Theme | null) ?? 'system';
      if (current === 'system') applyTheme('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    applyTheme(t);
    localStorage.setItem('be_theme', t);
    const session = getSession();
    if (session) persistTheme(session.username, t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
