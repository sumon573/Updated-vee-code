import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * 2026-10-14 (Sumon): check if a user has the Vee Official badge.
 * Uses REAL-TIME Firebase listeners — badge grant AND removal both reflect
 * live immediately (no stale cache). Matches Sumon's requirement that the
 * verified icon disappears the moment the badge is removed, everywhere
 * (chat list, contacts, profile name).
 *
 * 2026-10-19 (stability): module-level ref-counted subscription cache.
 * Previously every mounted row (chat list, contacts, voice-room members)
 * attached its own 2 RTDB listeners per uid — 100 chats = 200 badge
 * listeners, all torn down and recreated on every chat-list reorder. Now
 * one shared subscription per uid: the first mounted row attaches the 2
 * listeners, every other row for the same uid reuses them, and the last
 * unmount detaches. Hook API is unchanged — all callers benefit as-is.
 */

function computeVerified(officialBadgeExists: boolean, badgesVal: any): boolean {
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
}

interface BadgeEntry {
  verified: boolean;
  refCount: number;
  listeners: Set<(verified: boolean) => void>;
  unsubs: Array<() => void>;
  officialExists: boolean;
  badgesVal: any;
}

/** Module-level: one entry per uid, shared across every mounted component. */
const badgeCache = new Map<string, BadgeEntry>();

function ensureBadgeSubscription(uid: string): BadgeEntry {
  const existing = badgeCache.get(uid);
  if (existing) return existing;

  const entry: BadgeEntry = {
    verified: false,
    refCount: 0,
    listeners: new Set(),
    unsubs: [],
    officialExists: false,
    badgesVal: null,
  };

  const recompute = () => {
    const v = computeVerified(entry.officialExists, entry.badgesVal);
    if (v !== entry.verified) {
      entry.verified = v;
      for (const cb of entry.listeners) {
        try { cb(v); } catch { /* one bad listener must not break the rest */ }
      }
    }
  };

  // Listen to both paths — either change updates the verified state live.
  // 2026-10-19 polish: on listener error keep the last-known verified state
  // (a transient error must not flip a real badge off) and log.
  const onBadgeError = (e: Error) => {
    console.warn('[useVerifiedBadge] listener error:', e?.message || e);
  };
  entry.unsubs = [
    onValue(ref(database, `users/${uid}/officialBadge`), (snap) => {
      entry.officialExists = snap.exists();
      recompute();
    }, onBadgeError),
    onValue(ref(database, `users/${uid}/badges`), (snap) => {
      entry.badgesVal = snap.exists() ? snap.val() : null;
      recompute();
    }, onBadgeError),
  ];

  badgeCache.set(uid, entry);
  return entry;
}

/**
 * Subscribe to a uid's verified-badge state. Ref-counted: the first
 * subscriber attaches the 2 RTDB listeners, the last unsubscriber detaches
 * them. The callback fires immediately with the current value.
 */
export function subscribeVerifiedBadge(
  uid: string,
  cb: (verified: boolean) => void,
): () => void {
  const entry = ensureBadgeSubscription(uid);
  entry.refCount += 1;
  entry.listeners.add(cb);
  cb(entry.verified);
  return () => {
    entry.listeners.delete(cb);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      for (const unsub of entry.unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
      badgeCache.delete(uid);
    }
  };
}

export function useVerifiedBadge(uid: string | undefined | null): boolean {
  const [verified, setVerified] = useState<boolean>(() =>
    uid ? badgeCache.get(uid)?.verified ?? false : false,
  );

  useEffect(() => {
    if (!uid) {
      setVerified(false);
      return;
    }
    return subscribeVerifiedBadge(uid, setVerified);
  }, [uid]);

  return verified;
}

/**
 * @deprecated No longer needed — the ref-counted cache manages listener
 * lifetime automatically. Kept for backwards compatibility.
 */
export function clearVerifiedCache(_uid?: string) {
  // No-op: subscriptions detach when the last subscriber unmounts
}
