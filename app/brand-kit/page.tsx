'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { DEFAULT_BRAND_KIT, THEME_STYLES } from '@/lib/types';
import type { CreatorBrandKit, ThemeStyle, Tone } from '@/lib/types';
import { ArrowLeft, Plus, X, CheckCircle, Upload, Palette } from 'lucide-react';
import clsx from 'clsx';

const TONES: { id: Tone; label: string; desc: string }[] = [
  { id: 'friendly',       label: 'Friendly',       desc: 'Warm, approachable, and encouraging' },
  { id: 'conversational', label: 'Conversational', desc: 'Casual, natural, and easy to read' },
  { id: 'professional',   label: 'Professional',   desc: 'Polished, clear, and authoritative' },
  { id: 'academic',       label: 'Academic',       desc: 'Formal, precise, and in-depth' },
];

const FONT_OPTIONS = [
  { value: 'sans-serif',  label: 'Sans-serif (Default)' },
  { value: 'serif',       label: 'Serif' },
  { value: 'monospace',   label: 'Monospace' },
  { value: 'Inter',       label: 'Inter' },
  { value: 'Georgia',     label: 'Georgia' },
  { value: 'system-ui',   label: 'System UI' },
];

const inp =
  'w-full px-3.5 py-2.5 text-sm border border-gray-200 dark:border-slate-600 rounded-xl ' +
  'bg-white dark:bg-slate-800 text-gray-900 dark:text-white ' +
  'placeholder-gray-400 dark:placeholder-slate-500 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow';

const STORAGE_KEY = 'be_brand_kit';

function loadKit(): CreatorBrandKit {
  if (typeof window === 'undefined') return { ...DEFAULT_BRAND_KIT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_BRAND_KIT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_BRAND_KIT };
}

export function saveKit(kit: CreatorBrandKit) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kit));
  } catch { /* ignore */ }
}

export function useBrandKit(): CreatorBrandKit {
  if (typeof window === 'undefined') return { ...DEFAULT_BRAND_KIT };
  return loadKit();
}

export default function BrandKitPage() {
  const router = useRouter();
  const ready = useAuthGuard();
  const logoRef = useRef<HTMLInputElement>(null);
  const watermarkRef = useRef<HTMLInputElement>(null);

  const [kit, setKit] = useState<CreatorBrandKit>({ ...DEFAULT_BRAND_KIT });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKit(loadKit());
  }, []);

  if (!ready) return null;

  function patch(update: Partial<CreatorBrandKit>) {
    setKit(k => ({ ...k, ...update }));
  }

  function handleSave() {
    saveKit(kit);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleReset() {
    if (!confirm('Reset all brand kit settings to default?')) return;
    const fresh = { ...DEFAULT_BRAND_KIT };
    setKit(fresh);
    saveKit(fresh);
  }

  function handleImageUpload(field: 'logoUrl' | 'watermark', file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      patch({ [field]: result });
    };
    reader.readAsDataURL(file);
  }

  function addSocialLink() {
    patch({ socialLinks: [...kit.socialLinks, ''] });
  }
  function removeSocialLink(i: number) {
    patch({ socialLinks: kit.socialLinks.filter((_, idx) => idx !== i) });
  }
  function updateSocialLink(i: number, val: string) {
    const updated = [...kit.socialLinks];
    updated[i] = val;
    patch({ socialLinks: updated });
  }

  const label = (text: string, sub?: string) => (
    <div className="mb-1.5">
      <span className="block text-xs font-semibold text-gray-700 dark:text-slate-300">{text}</span>
      {sub && <span className="block text-xs text-gray-400 dark:text-slate-500">{sub}</span>}
    </div>
  );

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700 transition-colors">
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-none flex items-center gap-2">
              <Palette size={18} className="text-blue-600" /> Creator Brand Kit
            </h1>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Applied to every generated content asset.</p>
          </div>
        </div>

        <div className="space-y-5">

          {/* ── Identity ────────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-4">Creator Identity</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                {label('Creator Name')}
                <input className={inp} value={kit.creatorName} onChange={e => patch({ creatorName: e.target.value })} placeholder="Your name" />
              </div>
              <div>
                {label('Brand Name')}
                <input className={inp} value={kit.brandName} onChange={e => patch({ brandName: e.target.value })} placeholder="Your brand name" />
              </div>
              <div>
                {label('Platform Name', 'YouTube channel, podcast, newsletter, etc.')}
                <input className={inp} value={kit.platformName} onChange={e => patch({ platformName: e.target.value })} placeholder="e.g. The Money Mentor Show" />
              </div>
              <div>
                {label('Community / Audience Name', 'What you call your audience')}
                <input className={inp} value={kit.communityName} onChange={e => patch({ communityName: e.target.value })} placeholder="e.g. The Finance Fam" />
              </div>
              <div>
                {label('Website / Content Hub URL')}
                <input className={inp} value={kit.websiteUrl} onChange={e => patch({ websiteUrl: e.target.value })} placeholder="https://yourwebsite.com" type="url" />
              </div>
              <div>
                {label('Website Display Name')}
                <input className={inp} value={kit.websiteName} onChange={e => patch({ websiteName: e.target.value })} placeholder="e.g. MoneyMentor.com" />
              </div>
            </div>
          </section>

          {/* ── Logo & Watermark ─────────────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-4">Logo & Watermark</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                {label('Logo', 'Shown in headers of all generated assets')}
                <div className="flex items-center gap-3">
                  {kit.logoUrl && (
                    <img src={kit.logoUrl} alt="Logo preview" className="h-10 w-10 rounded object-contain border border-gray-200 dark:border-slate-600" />
                  )}
                  <button
                    type="button"
                    onClick={() => logoRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Upload size={13} /> Upload Logo
                  </button>
                  {kit.logoUrl && (
                    <button type="button" onClick={() => patch({ logoUrl: undefined })} className="text-red-400 hover:text-red-600">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload('logoUrl', e.target.files?.[0] ?? null)} />
              </div>

              <div>
                {label('Watermark', 'Image watermark or text watermark')}
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => patch({ watermarkType: 'text' })}
                    className={clsx('px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors', kit.watermarkType === 'text' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400')}
                  >Text</button>
                  <button
                    type="button"
                    onClick={() => patch({ watermarkType: 'image' })}
                    className={clsx('px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors', kit.watermarkType === 'image' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400')}
                  >Image</button>
                </div>
                {kit.watermarkType === 'text' ? (
                  <input className={inp} value={kit.watermark ?? ''} onChange={e => patch({ watermark: e.target.value })} placeholder="e.g. @yourbrand" />
                ) : (
                  <div className="flex items-center gap-3">
                    {kit.watermark && (
                      <img src={kit.watermark} alt="Watermark preview" className="h-8 w-8 rounded object-contain border border-gray-200 dark:border-slate-600 opacity-50" />
                    )}
                    <button
                      type="button"
                      onClick={() => watermarkRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg text-sm text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Upload size={13} /> Upload Image
                    </button>
                    {kit.watermark && (
                      <button type="button" onClick={() => patch({ watermark: undefined })} className="text-red-400 hover:text-red-600">
                        <X size={14} />
                      </button>
                    )}
                    <input ref={watermarkRef} type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload('watermark', e.target.files?.[0] ?? null)} />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── Brand Colors ─────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-4">Brand Colors</h2>
            <div className="grid grid-cols-3 gap-4">
              {([
                { field: 'primaryColor',   label: 'Primary', desc: 'Headings, buttons' },
                { field: 'secondaryColor', label: 'Secondary', desc: 'Accents, highlights' },
                { field: 'accentColor',    label: 'Accent', desc: 'Callouts, badges' },
              ] as const).map(({ field, label: l, desc }) => (
                <div key={field}>
                  <span className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-0.5">{l}</span>
                  <span className="block text-xs text-gray-400 dark:text-slate-500 mb-2">{desc}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={kit[field]}
                      onChange={e => patch({ [field]: e.target.value })}
                      className="w-10 h-9 rounded-lg border border-gray-200 dark:border-slate-600 cursor-pointer bg-transparent p-0.5"
                    />
                    <input
                      type="text"
                      value={kit[field]}
                      onChange={e => patch({ [field]: e.target.value })}
                      className="flex-1 px-2 py-2 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Typography & Theme ─────────────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-4">Typography & Content Theme</h2>
            <div className="mb-4">
              {label('Font Style')}
              <select className={inp} value={kit.fontStyle} onChange={e => patch({ fontStyle: e.target.value })}>
                {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              {label('Content Theme Style', 'Controls the visual look of your generated content assets')}
              <div className="grid grid-cols-4 gap-2 mt-2">
                {THEME_STYLES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch({ themeStyle: t.id as ThemeStyle })}
                    className={clsx(
                      'px-2 py-2 text-xs rounded-lg border font-medium transition-all',
                      kit.themeStyle === t.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500',
                    )}
                  >{t.label}</button>
                ))}
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">Note: app dark/light mode is set separately in Settings.</p>
            </div>
          </section>

          {/* ── Tone ──────────────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Content Tone</h2>
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">Default: Friendly. Controls the writing style of all generated content.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {TONES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => patch({ tone: t.id })}
                  className={clsx(
                    'text-left px-4 py-3 rounded-xl border-2 transition-all',
                    kit.tone === t.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500',
                  )}
                >
                  <span className={clsx('block text-sm font-semibold mb-0.5', kit.tone === t.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white')}>{t.label}</span>
                  <span className="block text-xs text-gray-500 dark:text-slate-400">{t.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── CTA & Links ────────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-4">CTA & Links</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                {label('CTA Button Text')}
                <input className={inp} value={kit.ctaText} onChange={e => patch({ ctaText: e.target.value })} placeholder="e.g. Visit my platform" />
              </div>
              <div>
                {label('CTA Link')}
                <input className={inp} value={kit.ctaLink} onChange={e => patch({ ctaLink: e.target.value })} placeholder="https://yourlink.com" type="url" />
              </div>
            </div>
            <div className="mb-4">
              {label('Social Links', 'Add links to your platform, newsletter, podcast, etc.')}
              <div className="space-y-2">
                {kit.socialLinks.map((link, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={inp} value={link} onChange={e => updateSocialLink(i, e.target.value)} placeholder="https://..." type="url" />
                    <button type="button" onClick={() => removeSocialLink(i)} className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addSocialLink} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                  <Plus size={12} /> Add link
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => patch({ enableQrCode: !kit.enableQrCode })}
                className={clsx(
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  kit.enableQrCode ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-600',
                )}
              >
                <span className={clsx('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform', kit.enableQrCode ? 'translate-x-4' : 'translate-x-1')} />
              </button>
              <span className="text-sm text-gray-700 dark:text-slate-300">Include QR code on assets</span>
            </div>
          </section>

          {/* ── Footer Text ────────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">Footer Text</h2>
            <textarea
              className={inp + ' resize-none'}
              rows={2}
              value={kit.footerText}
              onChange={e => patch({ footerText: e.target.value })}
              placeholder="e.g. © 2025 Your Brand · yourwebsite.com · Not financial advice."
            />
          </section>

        </div>

        {/* ── Save / Reset ──────────────────────────────────────────────────── */}
        <div className="flex gap-3 mt-6 pb-6">
          <button
            onClick={handleSave}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saved ? <><CheckCircle size={14} /> Saved!</> : 'Save Brand Kit'}
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-3 border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 text-sm font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            Reset
          </button>
        </div>

      </div>
    </Layout>
  );
}
