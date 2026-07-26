'use client';

import { useEffect, useState } from 'react';

/**
 * Returns `true` when the current visitor is a signed-in creator, `false`
 * once the check completes and they are not.  Unlike useAuthGuard this never
 * redirects — public audience pages use this so anonymous viewers can still
 * see content while creators get their extra editing controls.
 */
export function useIsCreator(): boolean {
  const [isCreator, setIsCreator] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => { if (res.ok) setIsCreator(true); })
      .catch(() => {});
  }, []);

  return isCreator;
}
