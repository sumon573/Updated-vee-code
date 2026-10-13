import { useState, useEffect } from 'react';
import { hasOfficialBadge } from '../services/verifiedService';

// Cache to avoid repeated Firebase reads for the same user
const cache = new Map<string, boolean>();
const pending = new Map<string, Promise<boolean>>();

/**
 * 2026-10-13 (Sumon): Hook to check if a user has the Vee Official badge.
 * Uses in-memory cache to avoid repeated Firebase reads.
 * Returns true if user has a valid (non-expired) official badge.
 */
export function useVerifiedBadge(uid: string | undefined | null): boolean {
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!uid) {
      setVerified(false);
      return;
    }

    // Check cache first
    if (cache.has(uid)) {
      setVerified(cache.get(uid)!);
      return;
    }

    // Check if already pending
    let promise = pending.get(uid);
    if (!promise) {
      promise = hasOfficialBadge(uid);
      pending.set(uid, promise);
    }

    promise.then((result) => {
      // 2026-10-14 (Sumon): Only cache POSITIVE results — negative cache
      // caused badge to not show for others after grant.
      if (result) {
        cache.set(uid, result);
      }
      pending.delete(uid);
      setVerified(result);
    }).catch(() => {
      pending.delete(uid);
      setVerified(false);
    });
  }, [uid]);

  return verified;
}

/**
 * Clear the cache (e.g., after badge granted/revoked)
 */
export function clearVerifiedCache(uid?: string) {
  if (uid) {
    cache.delete(uid);
  } else {
    cache.clear();
  }
}
