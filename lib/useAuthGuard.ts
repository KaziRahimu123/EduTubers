'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Blocks rendering until the session check completes.
 * Returns `true` only when the user is confirmed signed in.
 * Redirects to /auth immediately if not signed in.
 */
export function useAuthGuard(): boolean {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => {
        if (res.ok) {
          setReady(true);
        } else {
          router.replace('/auth');
        }
      })
      .catch(() => router.replace('/auth'));
  }, [router]);

  return ready;
}
