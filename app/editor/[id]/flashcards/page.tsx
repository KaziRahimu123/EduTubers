'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Save, Trash2, Plus, GripVertical,
  Copy, CheckCircle, ExternalLink,
  MessageSquare, Globe, Lock, Image as ImageIcon,
  RefreshCw, Upload, X, ChevronDown, ChevronUp, Palette,
} from 'lucide-react';
import Layout from '@/components/Layout';
import { RichField } from '@/components/RichNotesEditor';
import { dbGetCourse, dbSaveCourse, dbDeleteCourse, dbGetReviews, dbUploadImage, dbProxy, uid } from '@/lib/db';
import { cleanTitle } from '@/lib/cleanTitle';
import { encodePayload } from '@/lib/deckShare';
import type { Course, Flashcard, FlashcardDeckOptions, FlashcardReview } from '@/lib/types';
import clsx from 'clsx';

async function generateCardImage(
  term: string,
  back: string,
  courseId?: string,
  moduleIndex?: number,
  flashcardIndex?: number,
): Promise<string | null> {
  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: term, context: back, courseId, moduleIndex, flashcardIndex }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { publicUrl?: string; dataUrl?: string };
    return data.publicUrl ?? data.dataUrl ?? null;
  } catch {
    return null;
  }
}

// Pastel palette for colorful mode
const CARD_COLORS = [
  '#fde68a', '#a7f3d0', '#bfdbfe', '#ddd6fe', '#fecaca',
  '#fed7aa', '#d1fae5', '#e9d5ff', '#fce7f3', '#cffafe',
];

type CardWithMeta = Flashcard & { modIdx: number; cardIdx: number };

function buildShareUrl(course: Course): string {
  const cards = course.modules.flatMap(m => m.flashcards).map(f => ({ front: f.front, back: f.back, image: f.image }));
  const payload = encodePayload({
    title: course.title,
    description: course.description,
    colorful: course.flashcardOptions?.colorful ?? false,
    cards,
  });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const slug = course.slug ?? 'deck';
  return `${origin}/flashcards/${slug}?d=${payload}`;
}

export default function FlashcardEditor() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [allCards, setAllCards] = useState<CardWithMeta[]>([]);
  const [reviews, setReviews] = useState<FlashcardReview[]>([]);
  const [showReviews, setShowReviews] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const dragCard = useRef<string | null>(null);

  useEffect(() => {
    async function load() {
      const c = await dbGetCourse(id);
      if (!c) { router.replace('/dashboard'); return; }
      const ct = c.contentType as string;
      if (ct !== 'review_cards' && ct !== 'flashcards') { router.replace(`/editor/${id}`); return; }
      setCourse(c);
      flattenCards(c);
      const r = await dbGetReviews(id);
      setReviews(r);
      setLoading(false);

      // Auto-generate images for all cards in parallel when includeImages is on
      if (c.flashcardOptions?.includeImages) {
        const allFlashcards = c.modules.flatMap((m, mi) =>
          m.flashcards.map((f, fi) => ({ f, mi, fi }))
        );
        const needsImage = allFlashcards.filter(({ f }) => !f.image);
        if (needsImage.length === 0) return;

        // Mark all pending cards as generating immediately so UI shows skeletons
        setGeneratingImageIds(new Set(needsImage.map(({ f }) => f.id)));

        // Fire all requests in parallel — each resolves independently
        await Promise.all(needsImage.map(async ({ f, mi, fi }) => {
          // Pass courseId + moduleIndex + flashcardIndex — server patches modules[mi].flashcards[fi].image
          const publicUrl = await generateCardImage(f.front, f.back, c.id, mi, fi);
          // Remove from generating set as each finishes
          setGeneratingImageIds(prev => { const n = new Set(prev); n.delete(f.id); return n; });
          if (!publicUrl) return;
          // Update React state and save — use setCourse updater to always read latest state
          setCourse(prev => {
            if (!prev) return prev;
            const modules = prev.modules.map((m, mIdx) => {
              if (mIdx !== mi) return m;
              return { ...m, flashcards: m.flashcards.map((card, fIdx) => fIdx === fi ? { ...card, image: publicUrl } : card) };
            });
            const updated = { ...prev, modules };
            flattenCards(updated);
            dbSaveCourse(updated);
            return updated;
          });
        }));
      }
    }
    load();
  }, [id, router]);

  function flattenCards(c: Course) {
    setAllCards(c.modules.flatMap((m, mi) =>
      m.flashcards.map((f, fi) => ({ ...f, modIdx: mi, cardIdx: fi }))
    ));
  }

  function update(patch: Partial<Course>) {
    const updated = { ...course!, ...patch };
    setCourse(updated);
    flattenCards(updated);
    dbSaveCourse(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function patchFlashcard(modIdx: number, cardIdx: number, patch: Partial<Flashcard>) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      return { ...m, flashcards: m.flashcards.map((f, fi) => fi === cardIdx ? { ...f, ...patch } : f) };
    });
    update({ modules });
  }

  function deleteCard(modIdx: number, cardIdx: number) {
    if (!confirm('Delete this card?')) return;
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      return { ...m, flashcards: m.flashcards.filter((_, fi) => fi !== cardIdx) };
    });
    update({ modules });
  }

  function addFlashcard(modIdx = 0) {
    const modules = [...course!.modules];
    if (!modules.length) {
      modules.push({ id: uid(), title: 'Deck', objective: '', lessonNotes: '', examples: '', flashcards: [], quizQuestions: [], practiceTasks: [] });
    }
    // Clamp to last valid module index
    const target = Math.min(modIdx, modules.length - 1);
    modules[target] = {
      ...modules[target],
      flashcards: [...modules[target].flashcards, { id: uid(), front: 'New Front Term', back: 'New Back Definition' }],
    };
    update({ modules });
  }

  // Keep the old name as an alias so all existing call sites keep working
  const addCard = () => addFlashcard(0);

  function reorderCards(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const flat = [...allCards];
    const [moved] = flat.splice(fromIdx, 1);
    flat.splice(toIdx, 0, moved);
    const modules = course!.modules.map((m, mi) => {
      const cards = flat
        .filter(c => c.modIdx === mi)
        .map(({ modIdx: _mi, cardIdx: _ci, ...card }) => card as Flashcard);
      return { ...m, flashcards: cards };
    });
    update({ modules });
  }

  function updateFcOptions(patch: Partial<FlashcardDeckOptions>) {
    const current = course?.flashcardOptions ?? { cardCount: 0, colorful: false, includeImages: false };
    update({ flashcardOptions: { ...current, ...patch } });
  }

  async function togglePublish() {
    if (!course) return;
    const isPublishing = course.status !== 'published';
    let slug = course.slug;
    if (isPublishing && (!slug || slug.trim() === '')) {
      const res = await dbProxy<{ slug: string }>('make_slug', { title: course.title, existingCourseId: course.id });
      slug = res?.slug ?? cleanTitle(course.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    }
    const updated: Course = {
      ...course,
      status: isPublishing ? 'published' : 'draft',
      slug,
    };
    setCourse(updated);
    if (typeof flattenCards === 'function') flattenCards(updated);
    await dbSaveCourse(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function copyLink() {
    if (!course) return;
    const url = course.slug
      ? `${window.location.origin}/flashcards/${course.slug}`
      : buildShareUrl(course);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleTitleBlur() {
    setEditingTitle(false);
    if (!course) return;
    // Generate/update slug when title changes
    const res = await dbProxy<{ slug: string }>('make_slug', { title: course.title, existingCourseId: course.id });
    const slug = res?.slug ?? cleanTitle(course.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    update({ slug });
  }

  // ── Drag handlers ────────────────────────────────────────────────────────────

  function onDragStart(cardId: string) { dragCard.current = cardId; }
  function onDragOverCard(e: React.DragEvent, cardId: string) { e.preventDefault(); setDragOver(cardId); }
  function onDrop(targetId: string) {
    if (!dragCard.current || dragCard.current === targetId) { setDragOver(null); return; }
    const fromIdx = allCards.findIndex(c => c.id === dragCard.current);
    const toIdx   = allCards.findIndex(c => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragOver(null); return; }
    reorderCards(fromIdx, toIdx);
    dragCard.current = null;
    setDragOver(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return (
    <Layout>
      <div className="flex justify-center py-20">
        <div className="w-7 h-7 border-3 border-gray-300 border-t-purple-500 rounded-full animate-spin" />
      </div>
    </Layout>
  );

  if (!course) return (
    <Layout>
      <p className="text-center py-20 text-gray-500">
        Loading… <Link href="/dashboard" className="text-blue-600 underline">Back to dashboard</Link>
      </p>
    </Layout>
  );

  const fcOpts   = course.flashcardOptions ?? { cardCount: 0, colorful: false, includeImages: false };
  const colorful = fcOpts.colorful;

  return (
    <Layout>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <button onClick={() => router.push('/dashboard')}
            className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input autoFocus
                className="w-full text-2xl font-bold border-b-2 border-purple-500 bg-transparent focus:outline-none pb-1"
                value={course.title}
                onChange={e => setCourse(c => c ? { ...c, title: e.target.value } : c)}
                onBlur={handleTitleBlur} />
            ) : (
              <h1
                className="text-2xl font-bold text-gray-900 cursor-pointer hover:text-purple-600 transition-colors"
                onClick={() => setEditingTitle(true)}
                title="Click to edit"
              >
                {cleanTitle(course.title)}
              </h1>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                course.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                {course.status === 'published' ? <><Globe size={9} /> Published</> : <><Lock size={9} /> Draft</>}
              </span>
              <span className="text-xs text-gray-400">{allCards.length} card{allCards.length !== 1 ? 's' : ''}</span>
              {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> Saved</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => addFlashcard(0)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100"
          >
            <Plus size={14} /> Add Flashcard
          </button>
          <button
            onClick={() => setShowReviews(s => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <MessageSquare size={14} /> Reviews
            {reviews.length > 0 && <span className="bg-purple-100 text-purple-700 text-xs px-1.5 rounded-full font-medium">{reviews.length}</span>}
          </button>
          <button onClick={togglePublish}
            className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
              course.status === 'published'
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'bg-purple-600 text-white hover:bg-purple-700')}>
            {course.status === 'published' ? <><Lock size={13} /> Unpublish</> : <><Globe size={13} /> Publish</>}
          </button>
          <button
            onClick={() => dbSaveCourse(course)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
          >
            <Save size={13} /> Save
          </button>
          <button onClick={() => { dbDeleteCourse(id); router.push('/dashboard'); }}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* ── Public link banner ────────────────────────────────────────────────── */}
      {course.status === 'published' ? (
        <div className="rounded-xl p-4 mb-5 flex flex-wrap items-center gap-3 border bg-green-50 border-green-200">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Globe size={12} className="text-green-600" />
              <p className="text-xs font-semibold text-green-700">Published — Live shareable link</p>
            </div>
            <p className="text-sm font-mono truncate text-green-900">
              {typeof window !== 'undefined' ? window.location.origin : 'https://edutubers.com'}/flashcards/{course.slug}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={copyLink} className="px-3 py-1.5 text-xs font-medium text-green-700 bg-white border border-green-200 rounded-lg hover:bg-green-50">
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <a href={`/flashcards/${course.slug}`} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-1">
              <ExternalLink size={12} /> Open
            </a>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-4 mb-5 flex items-center justify-between border bg-amber-50 border-amber-200 text-amber-800">
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-amber-600" />
            <span className="text-xs font-medium">Draft — Publish this content to activate your public web link.</span>
          </div>
          <button onClick={togglePublish} className="px-3 py-1 text-xs font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700">
            Publish Now
          </button>
        </div>
      )}

      {/* ── Deck settings ────────────────────────────────────────────────────── */}
      <DeckSettings
        colorful={colorful}
        onColorfulChange={v => updateFcOptions({ colorful: v })}
        includeImages={fcOpts.includeImages}
        onIncludeImagesChange={v => updateFcOptions({ includeImages: v })}
      />

      {/* ── Reviews panel ────────────────────────────────────────────────────── */}
      {showReviews && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <MessageSquare size={14} className="text-purple-600" /> Viewer Reviews
            </h2>
            <button onClick={() => setShowReviews(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>
          {reviews.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No reviews yet. Share your public link to collect feedback.</p>
          ) : (
            <div className="space-y-3">
              {reviews.map(r => (
                <div key={r.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-sm font-semibold text-gray-800">{r.name}</p>
                    <p className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                  <p className="text-sm text-gray-600">{r.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Card list ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Cards
          <span className="ml-2 text-xs font-normal text-gray-400">{allCards.length} card{allCards.length !== 1 ? 's' : ''}</span>
        </h2>
        <button onClick={addCard}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
          <Plus size={12} /> Add Card
        </button>
      </div>

      <div className="space-y-3">
        {allCards.map((card, i) => {
          const bg = colorful ? CARD_COLORS[i % CARD_COLORS.length] : '#ffffff';
          return (
            <div
              key={card.id}
              draggable
              onDragStart={() => onDragStart(card.id)}
              onDragOver={e => onDragOverCard(e, card.id)}
              onDrop={() => onDrop(card.id)}
              onDragLeave={() => setDragOver(null)}
              className={clsx(
                'rounded-xl border p-4 transition-all',
                dragOver === card.id ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'
              )}
              style={{ backgroundColor: colorful ? bg : undefined }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GripVertical size={14} className="text-gray-300 cursor-grab" />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Card {i + 1}</span>
                </div>
                <button onClick={() => deleteCard(card.modIdx, card.cardIdx)}
                  className="p-1.5 text-gray-300 hover:text-red-400 rounded-lg hover:bg-red-50">
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Front (Term)</label>
                  <RichField value={card.front} onChange={v => patchFlashcard(card.modIdx, card.cardIdx, { front: v })} placeholder="Term or question…" minHeight="70px" accentColor="#7c3aed" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Back (Definition)</label>
                  <RichField value={card.back} onChange={v => patchFlashcard(card.modIdx, card.cardIdx, { back: v })} placeholder="Definition or answer…" minHeight="70px" accentColor="#7c3aed" />
                </div>
              </div>

              {/* Card image — shown when includeImages is on, or card already has an image, or is actively generating */}
              {(fcOpts.includeImages || card.image || generatingImageIds.has(card.id)) && (
                <CardImage
                  card={card}
                  index={i}
                  courseId={course.id}
                  generatingIds={generatingImageIds}
                  onGenerate={async () => {
                    setGeneratingImageIds(s => new Set(s).add(card.id));
                    // Pass courseId + moduleIndex + flashcardIndex — server patches the correct slot
                    const url = await generateCardImage(card.front, card.back, course.id, card.modIdx, card.cardIdx);
                    setGeneratingImageIds(s => { const n = new Set(s); n.delete(card.id); return n; });
                    if (url) {
                      patchFlashcard(card.modIdx, card.cardIdx, { image: url });
                    }
                  }}
                  onUpload={async (file) => {
                    const reader = new FileReader();
                    reader.onload = async e => {
                      const dataUrl = e.target?.result as string;
                      if (!dataUrl) return;
                      const publicUrl = await dbUploadImage(course.id, i, dataUrl) ?? dataUrl;
                      patchFlashcard(card.modIdx, card.cardIdx, { image: publicUrl });
                    };
                    reader.readAsDataURL(file);
                  }}
                  onRemove={() => patchFlashcard(card.modIdx, card.cardIdx, { image: undefined })}
                />
              )}
            </div>
          );
        })}

        {allCards.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-400 text-sm mb-3">No cards yet.</p>
            <button onClick={() => addFlashcard(0)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700">
              <Plus size={14} /> Add your first card
            </button>
          </div>
        )}
      </div>

      {/* Per-module "Add Flashcard" buttons — one after each module's last card */}
      {course.modules.map((mod, mi) => (
        <div key={mod.id ?? mi} className="mt-2 mb-4">
          <button
            onClick={() => addFlashcard(mi)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-purple-700 border border-dashed border-purple-300 rounded-xl hover:bg-purple-50 transition-colors"
          >
            <Plus size={14} /> Add Flashcard{course.modules.length > 1 ? ` to "${mod.title}"` : ''}
          </button>
        </div>
      ))}

      {/* Bottom save */}
      <div className="flex items-center justify-between pt-4">
        <button onClick={() => dbSaveCourse(course)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700">
          <Save size={14} /> Save Changes
        </button>
        {saved && <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> Changes saved</p>}
      </div>
    </Layout>
  );
}

// ── Deck settings panel ───────────────────────────────────────────────────────

function DeckSettings({
  colorful, onColorfulChange,
  includeImages, onIncludeImagesChange,
}: {
  colorful: boolean; onColorfulChange: (v: boolean) => void;
  includeImages: boolean; onIncludeImagesChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-5">
      <button
        onClick={() => setOpen(s => !s)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl"
      >
        <span className="flex items-center gap-2"><Palette size={14} className="text-gray-400" /> Deck settings</span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Colorful cards</p>
              <p className="text-xs text-gray-400">Each card gets a distinct pastel accent colour</p>
            </div>
            <Toggle value={colorful} onChange={onColorfulChange} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Include images</p>
              <p className="text-xs text-gray-400">AI-generated or upload your own per card (gpt-image-1 · medium)</p>
            </div>
            <Toggle value={includeImages} onChange={onIncludeImagesChange} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-card image component ──────────────────────────────────────────────────

function CardImage({
  card, index, courseId, generatingIds, onGenerate, onUpload, onRemove,
}: {
  card: CardWithMeta; index: number; courseId: string;
  generatingIds: Set<string>;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  void courseId; void index;
  const isGenerating = generatingIds.has(card.id);

  if (isGenerating) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-3 border border-dashed border-gray-200">
        <ImageIcon size={13} className="animate-pulse text-purple-400 flex-shrink-0" />
        Generating image with AI…
      </div>
    );
  }

  if (card.image) {
    return (
      <div className="mt-3 relative group rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
        {/* Fixed 16:9 container — full image always visible, never cropped */}
        <div style={{ aspectRatio: '16/9' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.image} alt={`Card ${index + 1} image`} className="w-full h-full object-contain block" />
        </div>
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            type="button"
            onClick={onGenerate}
            title="Regenerate with AI"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white bg-black/50 rounded-lg hover:bg-black/70"
          >
            <RefreshCw size={10} /> Regen
          </button>
          <label className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white bg-black/50 rounded-lg hover:bg-black/70 cursor-pointer" title="Replace with upload">
            <Upload size={10} /> Replace
            <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          </label>
          <button
            type="button"
            onClick={onRemove}
            title="Remove image"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white bg-red-500/70 rounded-lg hover:bg-red-600/80"
          >
            <X size={10} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onGenerate}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100"
      >
        <ImageIcon size={12} /> Generate image with AI
      </button>
      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
        <Upload size={12} /> Upload image
        <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
      </label>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={clsx(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
        value ? 'bg-purple-600' : 'bg-gray-200'
      )}
    >
      <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', value ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}
