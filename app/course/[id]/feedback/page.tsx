'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Star, Send } from 'lucide-react';
import { dbGetCourse, dbGetFeedback, dbAddFeedback, uid } from '@/lib/db';
import type { FeedbackComment, Course } from '@/lib/types';
import { RichField } from '@/components/RichNotesEditor';

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" onClick={() => onChange?.(i)} onMouseEnter={() => onChange && setHover(i)} onMouseLeave={() => onChange && setHover(0)} disabled={!onChange}>
          <Star size={22} fill={(hover || value) >= i ? '#f59e0b' : 'none'} stroke={(hover || value) >= i ? '#f59e0b' : '#d1d5db'} />
        </button>
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const params = useParams();
  const id = params.id as string;
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [name, setName] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    Promise.all([dbGetCourse(id), dbGetFeedback(id)]).then(([c, fb]) => {
      if (c) setCourse(c);
      setComments(fb);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" /></div>;

  if (!course || course.status !== 'published') {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Guide not available.</p></div>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fb = await dbAddFeedback({ courseId: id, name: name.trim() || 'Anonymous', rating, comment: comment.trim(), createdAt: new Date().toISOString() });
    if (fb) setComments(prev => [fb, ...prev]);
    setName(''); setRating(5); setComment(''); setSubmitted(true);
  }

  const avg = comments.length ? (comments.reduce((s, c) => s + c.rating, 0) / comments.length).toFixed(1) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href={`/course/${id}`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> Back</Link>
          <span className="text-sm font-semibold text-gray-700 truncate flex-1">{course.title}</span>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Feedback</h1>
        {avg && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 mb-6">
            <p className="text-3xl font-bold text-amber-500">{avg}</p>
            <Stars value={Math.round(parseFloat(avg))} />
            <p className="text-sm text-gray-500">{comments.length} review{comments.length !== 1 ? 's' : ''}</p>
          </div>
        )}
        {submitted ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center mb-6">
            <p className="text-green-700 font-semibold">Thank you for your feedback!</p>
            <button onClick={() => setSubmitted(false)} className="text-xs text-gray-500 underline mt-2">Leave another</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Leave a Review</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Name (optional)</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={name} onChange={e => setName(e.target.value)} placeholder="Anonymous" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Rating</label><Stars value={rating} onChange={setRating} /></div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Comment</label>
                <RichField value={comment} onChange={setComment} placeholder="What did you think?" minHeight="100px" />
              </div>
              <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"><Send size={14} /> Submit</button>
            </form>
          </div>
        )}
        {comments.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
            <div className="flex items-center justify-between mb-2"><p className="text-sm font-medium text-gray-900">{c.name}</p><Stars value={c.rating} /></div>
            <p className="text-sm text-gray-600">{c.comment}</p>
            <p className="text-xs text-gray-400 mt-1">{new Date(c.createdAt).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
