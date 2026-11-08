/**
 * svipService — Vee SVIP membership data layer (2026-10-19).
 *
 * RTDB model `svip/{uid}`:
 *   { tier: number, expiry: number (ms epoch), points: number, updatedAt: number }
 *
 * Rules (see database.rules.json): the membership node is written by the
 * server on purchase (or by admins). Readable by any authenticated
 * user — badges and room display need it.
 *
 * PURCHASE (2026-11-08, Full SVIP): the Join CTA buys the selected tier
 * with wallet diamonds via POST /wallet/svip/purchase (see purchaseSvip
 * below). The waitlist `svipWaitlist/{uid}` survives ONLY as a fallback
 * when that endpoint is unreachable — never as the primary path.
 */
import { getErrorCause } from '@/src/utils/errorDisplay';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getSvipPrivileges } from '@/src/features/svip/svipConfig';
import { authedWalletFetch } from '@/src/features/wallet/walletService';

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

/* ─────────────────────────────────────────────────────────────
 * SVIP PURCHASE (2026-11-08, Full SVIP): wallet-diamond purchase
 * via POST /wallet/svip/purchase — the same wallet service +
 * Bearer ID-token auth as the other wallet endpoints
 * (authedWalletFetch, getApiBase()).
 * Request: { tier, idempotencyKey }. Success: { success, tier,
 * expiry, points }. Failure: { success: false, error }.
 *
 * Idempotency: ONE UUID per purchase attempt, persisted in
 * AsyncStorage until the purchase resolves — a retry (tap again)
 * reuses the same key so the server can never double-charge.
 * The key is cleared ONLY on a confirmed success; every other
 * outcome keeps it. Never auto-retry: the user taps again.
 * ───────────────────────────────────────────────────────────── */

const SVIP_PURCHASE_KEY_PREFIX = 'svip_purchase_key:';

async function getSvipPurchaseKey(uid: string, tier: number): Promise<string> {
  const storageKey = `${SVIP_PURCHASE_KEY_PREFIX}${uid}:${tier}`;
  try {
    const existing = await AsyncStorage.getItem(storageKey);
    if (existing) return existing;
  } catch { /* fall through and mint a fresh key */ }
  const key = Crypto.randomUUID();
  try { await AsyncStorage.setItem(storageKey, key); } catch { /* in-memory use only */ }
  return key;
}

async function clearSvipPurchaseKey(uid: string, tier: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${SVIP_PURCHASE_KEY_PREFIX}${uid}:${tier}`);
  } catch { /* non-critical */ }
}

export type SvipPurchaseResult =
  | { ok: true; tier: number; expiry: number; points: number }
  | { ok: false; error: string; unavailable: boolean };

export async function purchaseSvip(uid: string, tier: number): Promise<SvipPurchaseResult> {
  if (!uid || tier < 1 || tier > 5) {
    return { ok: false, error: 'Invalid SVIP tier.', unavailable: false };
  }
  const idempotencyKey = await getSvipPurchaseKey(uid, tier);
  let res: Response;
  try {
    res = await authedWalletFetch('/wallet/svip/purchase', {
      method: 'POST',
      body: { tier, idempotencyKey },
    });
  } catch {
    // Network failure / timeout before reaching the server — the outcome
    // is unknown, so the key is KEPT: the user's next tap reuses it and
    // the server dedupes instead of double-charging.
    return { ok: false, error: 'Network request failed. Check your connection and try again.', unavailable: true };
  }
  // 404 (route not deployed yet) / 502 / 503 / 504 / 5xx: the endpoint is
  // unavailable — keep the key, caller falls back to the waitlist.
  if (res.status === 404 || res.status >= 500) {
    return { ok: false, error: 'SVIP purchase is unavailable right now.', unavailable: true };
  }
  const data = (await res.json().catch(() => null)) as {
    success?: boolean; tier?: number; expiry?: number; points?: number; error?: string;
  } | null;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'SVIP purchase is unavailable right now.', unavailable: true };
  }
  if (data.success === true) {
    await clearSvipPurchaseKey(uid, tier);
    return {
      ok: true,
      tier: typeof data.tier === 'number' ? data.tier : tier,
      expiry: typeof data.expiry === 'number' ? data.expiry : 0,
      points: typeof data.points === 'number' ? data.points : 0,
    };
  }
  // Server reached and rejected (e.g. insufficient diamonds): final, no
  // charge — keep the key so a retry after topping up reuses it.
  return {
    ok: false,
    error: typeof data.error === 'string' && data.error ? data.error : 'Purchase failed. Try again.',
    unavailable: false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * SVIP AUTO-GRANT (2026-11-08, boss rule: whoever is SVIP gets ALL
 * that tier's rewards). Reward definitions come from the server
 * node `svip_page/tiers/{tier}/rewards` — NEVER hardcoded here.
 * Grants land in users/{uid}/{frames,nameplates,badges,entryEffects}/
 * {id} as {id, name, icon, obtainedAt, validity, source} — the same
 * shape as the manual/noble grants. Only the purchased tier's
 * rewards are granted; an already-granted reward is never rewritten
 * (keeps the stored art — never downgrade). validity = membership
 * expiry, so rewards lapse with the membership.
 * Live RTDB rules let the OWNER write these collections (see the
 * "badges/frames/nameplates stay client-writable" comment in
 * database.rules.json) — the same path noble auto-grant already uses.
 * ───────────────────────────────────────────────────────────── */

export interface SvipPageReward {
  id: string;
  kind: 'frame' | 'nameplate' | 'badge' | 'entryEffect';
  label: string;
  art: string;
}

const SVIP_REWARD_NODE: Record<SvipPageReward['kind'], 'frames' | 'nameplates' | 'badges' | 'entryEffects'> = {
  frame: 'frames',
  nameplate: 'nameplates',
  badge: 'badges',
  entryEffect: 'entryEffects',
};

export async function loadSvipPageRewards(tier: number): Promise<SvipPageReward[]> {
  try {
    const { ref, get } = await import('firebase/database');
    const { database } = await import('@/src/config/firebase');
    const snap = await get(ref(database, `svip_page/tiers/${tier}/rewards`));
    if (!snap.exists()) return [];
    const raw = snap.val();
    const arr: unknown[] = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>);
    const out: SvipPageReward[] = [];
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue;
      const rec = r as Record<string, unknown>;
      if (typeof rec.id !== 'string' || !rec.id) continue;
      if (rec.kind !== 'frame' && rec.kind !== 'nameplate' && rec.kind !== 'badge' && rec.kind !== 'entryEffect') continue;
      if (typeof rec.label !== 'string' || !rec.label) continue;
      if (typeof rec.art !== 'string' || !rec.art) continue;
      out.push({ id: rec.id, kind: rec.kind, label: rec.label, art: rec.art });
    }
    return out;
  } catch {
    return [];
  }
}

export async function grantSvipTierRewards(
  uid: string,
  tier: number,
  expiry?: number,
): Promise<{ granted: string[]; failed: string[] }> {
  const granted: string[] = [];
  const failed: string[] = [];
  if (!uid || tier < 1 || tier > 5) return { granted, failed };
  const rewards = await loadSvipPageRewards(tier);
  if (rewards.length === 0) return { granted, failed };
  const now = Date.now();
  const validity = typeof expiry === 'number' && expiry > now ? expiry : now + 30 * 86400000;
  const { ref, get, set } = await import('firebase/database');
  const { database } = await import('@/src/config/firebase');
  for (const reward of rewards) {
    const node = SVIP_REWARD_NODE[reward.kind];
    try {
      const existing = await get(ref(database, `users/${uid}/${node}/${reward.id}`));
      if (existing.exists()) continue; // already granted — never rewrite
      await set(ref(database, `users/${uid}/${node}/${reward.id}`), {
        id: reward.id,
        name: reward.label,
        icon: reward.art,
        obtainedAt: now,
        validity,
        source: 'official',
        description: `SVIP privilege — SVIP ${tier} membership reward.`,
        grantedBy: 'svip-system',
      });
      granted.push(reward.id);
    } catch {
      failed.push(reward.id);
    }
  }
  return { granted, failed };
}

/** Session-once guard so a membership snapshot re-delivery never re-grants. */
const svipRewardsEnsured = new Set<string>();

/**
 * Grant the tier's rewards for ANY membership activation — a fresh
 * purchase, or the app reading an existing `svip/{uid}` (backfill for
 * members granted before auto-grant existed). Idempotent: existing
 * grants are skipped and each (uid, tier) runs at most once per session.
 */
export async function ensureSvipRewards(uid: string, state: SvipState | null): Promise<void> {
  if (!uid || !isSvipActive(state)) return;
  const key = `${uid}:${state!.tier}`;
  if (svipRewardsEnsured.has(key)) return;
  svipRewardsEnsured.add(key);
  try {
    await grantSvipTierRewards(uid, state!.tier, state!.expiry);
  } catch { /* non-critical — next session retries */ }
}
