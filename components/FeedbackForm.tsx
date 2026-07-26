'use client';

import { useState } from 'react';
import { Send, MessageSquare, CheckCircle } from 'lucide-react';
import { dbAddReview } from '@/lib/db';

interface Props {
  courseId: string;
  contentTitle: string;
  accentColor?: 'purple' | 'orange' | 'green' | 'indigo' | 'rose';
}

const ACCENTS = {
  purple: {
    border: 'border-purple-200',  bg: 'bg-purple-50',
    label: 'text-purple-700',     btn: 'bg-purple-600 hover:bg-purple-700',
    ring: 'focus:ring-purple-500',
  },
  orange: {
    border: 'border-orange-200',  bg: 'bg-orange-50',
    label: 'text-orange-700',     btn: 'bg-orange-500 hover:bg-orange-600',
    ring: 'focus:ring-orange-400',
  },
  green: {
    border: 'border-green-200',   bg: 'bg-green-50',
    label: 'text-green-700',      btn: 'bg-green-600 hover:bg-green-700',
    ring: 'focus:ring-green-500',
  },
  indigo: {
    border: 'border-indigo-200',  bg: 'bg-indigo-50',
    label: 'text-indigo-700',     btn: 'bg-indigo-600 hover:bg-indigo-700',
    ring: 'focus:ring-indigo-500',
  },
  rose: {
    border: 'border-rose-200',    bg: 'bg-rose-50',
    label: 'text-rose-700',       btn: 'bg-rose-600 hover:bg-rose-700',
    ring: 'focus:ring-rose-500',
  },
};

export default function FeedbackForm({ courseId, contentTitle, accentColor = 'purple' }: Props) {
  const a = ACCENTS[accentColor];
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setSubmitting(true);
    setError('');
    const result = await dbAddReview({
      courseId,
      name: name.trim() || 'Anonymous',
      comment: comment.trim().slice(0, 100),
    });
    setSubmitting(false);
    if (result) {
      setSubmitted(true);
    } else {
      setError('Could not save feedback. Please try again.');
    }
  }

  if (submitted) {
    return (
      <div className={`rounded-xl border ${a.border} ${a.bg} p-4 flex items-center gap-3`}>
        <CheckCircle size={18} className={a.label} />
        <div>
          <p className={`text-sm font-semibold ${a.label}`}>Thanks for your feedback!</p>
          <p className="text-xs text-gray-500 mt-0.5">Your response on &quot;{contentTitle}&quot; has been recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${a.border} ${a.bg} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={14} className={a.label} />
        <p className={`text-sm font-semibold ${a.label}`}>Leave feedback</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-2.5">
        <input
          type="text"
          placeholder="Your name (optional)"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={40}
          className={`w-full px-3 py-2 text-sm text-gray-900 dark:text-slate-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 ${a.ring}`}
        />
        <div>
          <textarea
            placeholder="What did you think? (max 100 characters)"
            value={comment}
            onChange={e => setComment(e.target.value.slice(0, 100))}
            required
            rows={2}
            className={`w-full px-3 py-2 text-sm text-gray-900 dark:text-slate-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 ${a.ring} resize-none`}
          />
          <p className="text-xs text-gray-400 text-right -mt-1">{comment.length}/100</p>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !comment.trim()}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${a.btn}`}
        >
          <Send size={13} />
          {submitting ? 'Sending…' : 'Submit Feedback'}
        </button>
      </form>
    </div>
  );
}
