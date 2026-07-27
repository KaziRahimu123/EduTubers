'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

interface ThemeContextValue {
  theme: 'light';
  setTheme: (t: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function enforceLightMode() {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState<'light'>('light');

  useEffect(() => {
    enforceLightMode();
    localStorage.removeItem('be_theme');
    localStorage.setItem('theme', 'light');

    // Continuously strip .dark class if added dynamically by third-party extensions
    const observer = new MutationObserver(() => {
      if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'light', setTheme: () => enforceLightMode() }}>
      {children}
    </ThemeContext.Provider>
  );
}
