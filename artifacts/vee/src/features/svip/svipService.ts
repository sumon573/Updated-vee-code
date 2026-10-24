/**
 * svipService — Vee SVIP membership data layer (2026-10-19).
 *
 * RTDB model `svip/{uid}`:
 *   { tier: number, expiry: number (ms epoch), points: number, updatedAt: number }
 *
 * Rules (see database.rules.json): written ONLY by admins (boss grants SVIP
 * manually until the payment flow is decided). Readable by any authenticated
 * user — badges and room display need it.
 *
 * Waitlist `svipWaitlist/{uid}`: { createdAt } — users add themselves; the
 * "Become SVIP" CTA writes here (real functionality, no fake purchase).
 */
import { getErrorCause } from '@/src/utils/errorDisplay';
import { getSvipPrivileges } from '@/src/features/svip/svipConfig';

export interface SvipState {
  tier: number;
  expiry: number;
  points: number;
  updatedAt: number;
}

export function isSvipActive(s: SvipState | null): boolean {
  return !!s && s.tier > 0 && s.expiry > Date.now();
}

/** Days (with 1 decimal) remaining on the membership. */
export function svipDaysLeft(s: SvipState | null): number {
  if (!isSvipActive(s)) return 0;
  return Math.max(0, (s!.expiry - Date.now()) / 86400000);
}

export function formatSvipExpiry(expiry: number): string {
  try {
    const d = new Date(expiry);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function subscribeSvip(
  uid: string,
  cb: (s: SvipState | null) => void,
  onError?: (e: unknown) => void,
): () => void {
  let detach: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    try {
      const { ref, onValue } = await import('firebase/database');
      const { database } = await import('@/src/config/firebase');
      if (cancelled) return;
      const r = ref(database, `svip/${uid}`);
      detach = onValue(
        r,
        (snap) => {
          const v = snap.val();
          if (!v || typeof v.tier !== 'number') {
            cb(null);
            return;
          }
          cb({
            tier: v.tier || 0,
            expiry: typeof v.expiry === 'number' ? v.expiry : 0,
            points: typeof v.points === 'number' ? v.points : 0,
            updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
          });
        },
        (e) => onError?.(e),
      );
    } catch (e) {
      if (!cancelled) onError?.(e);
    }
  })();
  return () => {
    cancelled = true;
    try { detach?.(); } catch { /* non-critical */ }
  };
}

/**
 * Join the SVIP waitlist. Real write — the user signals interest and the
 * Vee team can see it in `svipWaitlist`. Idempotent (one entry per user).
 */
export async function joinSvipWaitlist(uid: string): Promise<void> {
  const { ref, set, serverTimestamp } = await import('firebase/database');
  const { database } = await import('@/src/config/firebase');
  try {
    await set(ref(database, `svipWaitlist/${uid}`), {
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    throw new Error(getErrorCause(e));
  }
}

/** True when an SVIP privilege is genuinely active: tier reached, privilege has a real code path, membership not expired. */
export function hasSvipPrivilege(s: SvipState | null, key: string): boolean {
  if (!isSvipActive(s)) return false;
  const p = getSvipPrivileges().find((d) => d.key === key);
  return !!p && p.enforced && s!.tier >= p.minTier;
}

export async function isOnSvipWaitlist(uid: string): Promise<boolean> {
  const { ref, get } = await import('firebase/database');
  const { database } = await import('@/src/config/firebase');
  try {
    const snap = await get(ref(database, `svipWaitlist/${uid}`));
    return snap.exists();
  } catch {
    return false;
  }
}
