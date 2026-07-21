'use client';

import { useState, useRef, useEffect } from 'react';
import { Type, Bold, ChevronDown } from 'lucide-react';
import { FONTS, getFontOption } from '@/lib/fontConfig';
import type { FontSettings } from '@/lib/fontConfig';

interface Props {
  settings: FontSettings;
  onChange: (s: FontSettings) => void;
}

export default function FontSelector({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = getFontOption(settings.fontId);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="flex items-center gap-1 print:hidden">
      {/* Font picker */}
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
        >
          <Type size={12} />
          <span style={{ fontFamily: current.family }}>{current.label}</span>
          <ChevronDown size={11} className="text-gray-400" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-48">
            {FONTS.map(font => (
              <button
                key={font.id}
                onClick={() => { onChange({ ...settings, fontId: font.id }); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between transition-colors ${
                  settings.fontId === font.id ? 'text-blue-600 bg-blue-50' : 'text-gray-700'
                }`}
                style={{ fontFamily: font.family }}
              >
                {font.label}
                {settings.fontId === font.id && <span className="text-blue-500 text-xs">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bold toggle */}
      <button
        onClick={() => onChange({ ...settings, bold: !settings.bold })}
        title="Toggle bold text"
        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
          settings.bold
            ? 'bg-gray-900 border-gray-900 text-white'
            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
        }`}
      >
        <Bold size={13} />
      </button>
    </div>
  );
}
