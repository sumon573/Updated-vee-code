import { useEffect, useState } from 'react';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';

/* ── usePkBattlerPhotos — resolve PK battler DPs ──────────────────────
 * 2026-11-11 (boss 23:00): one battler's DP showed only the letter "R".
 * Root cause: the banner + result popup read the photo ONLY from the
 * seat entry (seats.find(...)?.photoURL). A seat entry has NO photoURL
 * when the battler took the seat before their profile photo loaded, or
 * when they left the seat by the time the result renders — even though
 * the user HAS a photo in users/{uid}/photoURL (RAKIB: verified live
 * 2026-11-11 — uid 39er1mchuzTA59HWnr9aOhwmpt73, photoURL exists, JPEG,
 * HTTP 200, 72KB — it just never reached the popup).
 * Fix: seat photo first (fast, consistent with the room), else a one-shot
 * get() of users/{uid}/photoURL, cached per uid in a module map so the
 * banner, modal and popup share one fetch. No subscription, no poll, no
 * timer. A fetched null is cached too (a user with no photo is never
 * re-fetched). The canonical DP source is users/{uid}/photoURL — the
 * same source the profile popup uses (OTA 01a1c973 / 01a1ca60). */
const profilePhotoCache = new Map<string, string | null>();
const profilePhotoInflight = new Set<string>();

export function usePkBattlerPhotos(
  challengerUid: string,
  opponentUid: string,
  challengerSeatPhoto?: string | null,
  opponentSeatPhoto?: string | null,
): { challengerPhotoURL: string | null; opponentPhotoURL: string | null } {
  const [fetched, setFetched] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const pairs: Array<[string, string | null | undefined]> = [
      [challengerUid, challengerSeatPhoto],
      [opponentUid, opponentSeatPhoto],
    ];
    const missing = pairs
      .filter(([uid, seatPhoto]) => !!uid && !seatPhoto && !profilePhotoCache.has(uid) && !profilePhotoInflight.has(uid))
      .map(([uid]) => uid);
    if (missing.length === 0) return;
    let cancelled = false;
    missing.forEach((uid) => profilePhotoInflight.add(uid));
    Promise.all(
      missing.map(async (uid) => {
        let url: string | null = null;
        try {
          const snap = await get(ref(database, `users/${uid}/photoURL`));
          url = typeof snap.val() === 'string' && snap.val() ? (snap.val() as string) : null;
        } catch {
          url = null;
        }
        profilePhotoCache.set(uid, url);
        profilePhotoInflight.delete(uid);
        return [uid, url] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setFetched((prev) => {
        const next = { ...prev };
        for (const [uid, url] of entries) next[uid] = url;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [challengerUid, opponentUid, challengerSeatPhoto, opponentSeatPhoto]);

  const resolve = (uid: string, seatPhoto?: string | null): string | null => {
    if (seatPhoto) return seatPhoto;
    if (profilePhotoCache.has(uid)) return profilePhotoCache.get(uid) ?? null;
    if (fetched[uid] !== undefined) return fetched[uid];
    return null;
  };

  return {
    challengerPhotoURL: resolve(challengerUid, challengerSeatPhoto),
    opponentPhotoURL: resolve(opponentUid, opponentSeatPhoto),
  };
}
