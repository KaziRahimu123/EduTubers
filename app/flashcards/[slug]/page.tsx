'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, RotateCcw, MessageSquare, Send, X, Lock } from 'lucide-react';
import EduTubersLogo from '@/components/EduTubersLogo';
import { dbGetCourseBySlug, dbGetReviews, dbAddReview, dbGetImages, dbIncrementViews, dbIncrementCompletions, uid } from '@/lib/db';
import { decodePayload } from '@/lib/deckShare';
import type { Flashcard, FlashcardReview } from '@/lib/types';
import clsx from 'clsx';

// Pastel palette for colorful mode
const CARD_COLORS = [
  '#fde68a', // amber
  '#a7f3d0', // emerald
  '#bfdbfe', // blue
  '#ddd6fe', // violet
  '#fecaca', // red
  '#fed7aa', // orange
  '#d1fae5', // teal
  '#e9d5ff', // purple
  '#fce7f3', // pink
  '#cffafe', // cyan
];

function FlipCard({
  card,
  index,
  colorful,
}: {
  card: Flashcard;
  index: number;
  colorful: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const bg = colorful ? CARD_COLORS[index % CARD_COLORS.length] : '#ffffff';

  return (
    <div
      className="w-full cursor-pointer select-none"
      style={{ perspective: '1200px' }}
      onClick={() => setFlipped(f => !f)}
    >
      <div
        className="relative w-full transition-transform duration-500"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          minHeight: '220px',
        }}
      >
        {/* Front */}
        <div
          className="absolute inset-0 rounded-2xl border border-gray-200 overflow-hidden shadow-sm"
          style={{ backfaceVisibility: 'hidden', backgroundColor: bg }}
        >
          {card.image ? (
            /* Side-by-side: image left, text right */
            <div className="flex h-full">
              <div className="w-2/5 flex-shrink-0 flex items-center justify-center border-r border-gray-200/60"
                style={{ backgroundColor: bg }}>
                <img
                  src={card.image}
                  alt=""
                  className="w-full h-full object-contain"
                  style={{ maxHeight: '220px' }}
                />
              </div>
              <div className="flex-1 flex flex-col items-center justify-center px-5 py-6 text-center">
                <p className="text-lg font-bold text-gray-900 leading-snug">{card.front}</p>
                <p className="text-xs text-gray-400 mt-3">Tap to flip</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
              <p className="text-lg font-bold text-gray-900 leading-snug">{card.front}</p>
              <p className="text-xs text-gray-400 mt-3">Tap to flip</p>
            </div>
          )}
        </div>
        {/* Back */}
        <div
          className="absolute inset-0 rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex items-center justify-center"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', backgroundColor: bg }}
        >
          <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
            <p className="text-base text-gray-700 leading-relaxed">{card.back}</p>
            <p className="text-xs text-gray-400 mt-3">Tap to flip back</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Minimal deck shape decoded from the URL param
interface DecodedDeck {
  title: string;
  description: string;
  colorful: boolean;
  cards: Flashcard[];
  deckId?: string; // set when loaded from localStorage (for reviews)
}

function PublicFlashcardViewer() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;

  const [deck, setDeck] = useState<DecodedDeck | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isUnpublished, setIsUnpublished] = useState(false);
  const [current, setCurrent] = useState(0);
  const [completionFired, setCompletionFired] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [reviews, setReviews] = useState<FlashcardReview[]>([]);
  const [reviewName, setReviewName] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const encoded = searchParams.get('d');

    async function load() {
      // ── Path 1: URL contains encoded payload ──────────────────────────────
      if (encoded) {
        const payload = decodePayload(encoded);
        if (!payload) { setNotFound(true); return; }
        const cards: Flashcard[] = payload.cards.map((c, i) => ({ id: String(i), front: c.front, back: c.back, ...(c.image ? { image: c.image } : {}) }));
        setDeck({ title: payload.title, description: payload.description, colorful: payload.colorful, cards });
        const c = await dbGetCourseBySlug(slug);
        if (c) {
          dbIncrementViews(c.id);
          setReviews(await dbGetReviews(c.id));
        }
        return;
      }

      // ── Path 2: No payload — look up by slug from DB ──────────────────────
      const c = await dbGetCourseBySlug(slug);
      if (!c) { setNotFound(true); return; }
      const ct = c.contentType as string;
      if (ct !== 'review_cards' && ct !== 'flashcards') { setNotFound(true); return; }
      if (c.status !== 'published') { setIsUnpublished(true); return; }
      dbIncrementViews(c.id);
      const flat = c.modules.flatMap(m => m.flashcards);
      // Hydrate any images stored in the images table that aren't already on the card
      const storedImages = await dbGetImages(c.id);
      const cards = flat.map((card, i) => ({
        ...card,
        image: card.image ?? storedImages[i] ?? undefined,
      }));
      setDeck({ title: c.title, description: c.description, colorful: c.flashcardOptions?.colorful ?? false, cards, deckId: c.id });
      setReviews(await dbGetReviews(c.id));
    }
    load();
  }, [slug, searchParams]);

  if (isUnpublished) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 text-center">
        <div className="max-w-md bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <Lock size={24} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Content Currently Unpublished</h2>
          <p className="text-sm text-gray-500 mb-6">
            This content is currently in draft mode. Click Publish in your studio editor to make it live.
          </p>
          <Link href="/dashboard" className="inline-flex items-center justify-center px-4 py-2 bg-purple-600 text-white font-medium text-sm rounded-lg hover:bg-purple-700">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 text-center">
        <div className="max-w-md bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <Lock size={24} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Deck not found</h2>
          <p className="text-sm text-gray-500 mb-6">
            This flashcard deck doesn&apos;t exist or the link may be invalid.
          </p>
          <Link href="/" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition-colors">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  if (!deck) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const colorful = deck.colorful;
  const cards = deck.cards;
  const total = cards.length;

  function prev() { setCurrent(i => (i > 0 ? i - 1 : total - 1)); }
  function next() {
    const deckId = deck?.deckId;
    setCurrent(i => {
      const nextIdx = i < total - 1 ? i + 1 : 0;
      // Fire completion when the visitor reaches the last card for the first time
      if (nextIdx === total - 1 && !completionFired && deckId) {
        dbIncrementCompletions(deckId);
        setCompletionFired(true);
      }
      return nextIdx;
    });
  }

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewComment.trim() || !deck) return;
    const courseId = deck.deckId ?? slug;
    const saved = await dbAddReview({
      courseId,
      name: reviewName.trim() || 'Anonymous',
      comment: reviewComment.trim().slice(0, 50),
    });
    if (saved) setReviews(prev => [saved, ...prev]);
    setReviewName('');
    setReviewComment('');
    setReviewSubmitted(true);
  }

  const inp = 'w-full px-3 py-2 text-sm text-gray-900 dark:text-slate-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <EduTubersLogo size={20} />
            <span className="text-sm font-semibold text-gray-700">EduTubers</span>
          </div>
          <button
            onClick={() => setShowReviews(true)}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-purple-600 transition-colors"
          >
            <MessageSquare size={14} />
            Reviews {reviews.length > 0 && <span className="bg-purple-100 text-purple-700 px-1.5 rounded-full font-medium">{reviews.length}</span>}
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Deck title */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">{deck.title}</h1>
          {deck.description && (
            <p className="text-sm text-gray-500 mt-1">{deck.description}</p>
          )}
          <p className="text-xs text-gray-400 mt-2">{total} card{total !== 1 ? 's' : ''}</p>
        </div>

        {total === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
            <p className="text-gray-400">No cards in this deck yet.</p>
          </div>
        ) : (
          <>
            {/* Progress bar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-purple-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${((current + 1) / total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 flex-shrink-0">{current + 1} / {total}</span>
            </div>

            {/* Card */}
            <FlipCard
              key={current}
              card={cards[current]}
              index={current}
              colorful={colorful}
            />

            {/* Navigation */}
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={prev}
                className="p-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors"
                aria-label="Previous card"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={() => setCurrent(0)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 bg-white rounded-xl"
              >
                <RotateCcw size={13} /> Restart
              </button>
              <button
                onClick={next}
                className="p-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors"
                aria-label="Next card"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Dot navigation */}
            <div className="flex justify-center gap-1.5 mt-4 flex-wrap">
              {cards.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  className={clsx(
                    'w-2 h-2 rounded-full transition-colors',
                    i === current ? 'bg-purple-500' : 'bg-gray-300 hover:bg-gray-400'
                  )}
                />
              ))}
            </div>
          </>
        )}

        {/* Leave a review CTA */}
        <div className="mt-10 text-center">
          <button
            onClick={() => setShowReviews(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition-colors"
          >
            <MessageSquare size={15} /> Leave a review
          </button>
        </div>
      </div>

      {/* Reviews drawer */}
      {showReviews && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowReviews(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Reviews</h2>
              <button onClick={() => setShowReviews(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {/* Submit form */}
              {reviewSubmitted ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <p className="text-green-700 font-semibold text-sm">Thanks for your review!</p>
                  <button onClick={() => setReviewSubmitted(false)} className="text-xs text-gray-500 underline mt-1">Leave another</button>
                </div>
              ) : (
                <form onSubmit={handleReviewSubmit} className="bg-gray-50 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-700">Add a review</p>
                  <input
                    className={inp}
                    placeholder="Your name (optional)"
                    value={reviewName}
                    onChange={e => setReviewName(e.target.value)}
                    maxLength={40}
                  />
                  <div>
                    <textarea
                      ref={commentRef}
                      className={clsx(inp, 'min-h-[70px] resize-none')}
                      placeholder="Your comment (max 50 characters)"
                      value={reviewComment}
                      onChange={e => setReviewComment(e.target.value.slice(0, 50))}
                      required
                    />
                    <p className="text-xs text-gray-400 text-right">{reviewComment.length}/50</p>
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
                  >
                    <Send size={13} /> Post Review
                  </button>
                </form>
              )}

              {/* Existing reviews */}
              {reviews.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No reviews yet. Be the first!</p>
              ) : (
                reviews.map(r => (
                  <div key={r.id} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-gray-800">{r.name}</p>
                      <p className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</p>
                    </div>
                    <p className="text-sm text-gray-600">{r.comment}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PublicFlashcardViewer />
    </Suspense>
  );
}

// Tell Next.js not to attempt server-side rendering for this route.
// All data lives in the user's browser (localStorage / IndexedDB) so there
// is nothing to render on the server — SSR would only produce errors.
export const dynamic = 'force-dynamic';
