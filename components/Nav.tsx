'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { LayoutDashboard, PlusCircle, Settings, LogOut, ChevronDown } from 'lucide-react';
import { EduTubersWordmark } from '@/components/EduTubersLogo';

export default function Nav() {
  const path = usePathname();
  const [username, setUsername] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((u: { name?: string; email?: string } | null) => {
        setUsername(u ? (u.name || u.email?.split('@')[0] || null) : null);
      })
      .catch(() => setUsername(null));
  }, [path]); // re-check on every navigation

  const active = (to: string) => path.startsWith(to);

  function handleSignOut() {
    setMenuOpen(false);
    // Auth0 logout — clears cookie and redirects home
    window.location.href = '/api/auth/logout';
  }

  const initials = username ? username.slice(0, 2).toUpperCase() : '';

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <EduTubersWordmark iconSize={28} className="text-base" />
        </Link>

        <nav className="flex items-center gap-1">
          {username ? (
            <>
              {[
                { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
                { to: '/generate',  label: 'Create',    icon: PlusCircle },
              ].map(({ to, label, icon: Icon }) => (
                <Link key={to} href={to}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${active(to) ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`}
                >
                  <Icon size={15} /> {label}
                </Link>
              ))}

              {/* User menu */}
              <div className="relative ml-1">
                <button
                  onClick={() => setMenuOpen(o => !o)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                    {initials}
                  </div>
                  <span className="hidden sm:inline">{username}</span>
                  <ChevronDown size={13} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>

                {menuOpen && (
                  <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
                      <Link
                        href="/settings"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                      >
                        <Settings size={14} /> Settings
                      </Link>
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <LogOut size={14} /> Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <Link
              href="/auth"
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
