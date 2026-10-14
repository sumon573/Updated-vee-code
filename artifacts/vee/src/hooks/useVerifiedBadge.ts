import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * 2026-10-14 (Sumon): Hook to check if a user has the Vee Official badge.
 * Uses REAL-TIME Firebase listeners — badge grant AND removal both reflect
 * live immediately (no stale cache). Matches Sumon's requirement that the
 * verified icon disappears the moment the badge is removed, everywhere
 * (chat list, contacts, profile name).
 */
export function useVerifiedBadge(uid: string | undefined | null): boolean {
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!uid) {
      setVerified(false);
      return;
    }

    const checkBadge = (officialBadgeExists: boolean, badgesVal: any): boolean => {
      if (officialBadgeExists) return true;
      if (!badgesVal) return false;
      const now = Date.now();
      return Object.values(badgesVal).some((b: any) => {
        const isOfficial = (b?.name || '').toLowerCase().trim() === 'vee official';
        if (!isOfficial) return false;
        if (b.validity === 'permanent' || !b.validity) return true;
        const expiry = typeof b.validity === 'number' ? b.validity : b.expiresAt;
        return typeof expiry === 'number' ? expiry > now : true;
      });
    };

    let officialExists = false;
    let badgesVal: any = null;

    // Listen to both paths — either change updates the verified state live
    const unsubOfficial = onValue(ref(database, `users/${uid}/officialBadge`), (snap) => {
      officialExists = snap.exists();
      setVerified(checkBadge(officialExists, badgesVal));
    });

    const unsubBadges = onValue(ref(database, `users/${uid}/badges`), (snap) => {
      badgesVal = snap.exists() ? snap.val() : null;
      setVerified(checkBadge(officialExists, badgesVal));
    });

    return () => {
      unsubOfficial();
      unsubBadges();
    };
  }, [uid]);

  return verified;
}

/**
 * @deprecated No longer needed — useVerifiedBadge now uses real-time listeners.
 * Kept for backwards compatibility with existing callers.
 */
export function clearVerifiedCache(_uid?: string) {
  // No-op: real-time listeners make manual cache clearing unnecessary
}
