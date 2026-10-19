/**
 * Short ID Service — purchase via server, admin grant (2026-10-09).
 *
 * C5-C8 FIX: All purchases go through POST /api/wallet/purchase-short-id
 * (atomic server-side: balance check + debit + ID claim + mapping).
 * Direct client writes to shortIds/ are BLOCKED by Firebase rules —
 * the old claimShortId() did free direct writes (security hole).
 *
 * - Users: shortIds/users/{id} → {ownerUid, ...}, users/{uid}/shortId → id
 * - Rooms: shortIds/rooms/{id} → {ownerUid, ...}, rooms/{roomId}/info/shortId → id
 */

import { ref, get, set } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';
import { getApiBase } from '@/src/utils/platform';

export type ShortIdKind = 'users' | 'rooms';

/** Price catalog (mirrors server) */
const SHORT_ID_PRICES: Record<string, number> = {
  '8888': 50000,
  '6666': 25000, '7777': 25000, '9999': 25000,
  '1234': 10000, '4321': 10000, '1314': 10000, '5200': 10000,
  '1000': 5000, '2000': 5000, '3000': 5000, '5000': 5000, '8000': 5000,
};
export function getShortIdPrice(shortId: string): number {
  return SHORT_ID_PRICES[shortId] ?? 1000;
}

// 2026-10-19 CRASH-RISK fix (random Short-ID overcharge): the random-ID card
// is advertised at a FLAT 1000 (RANDOM_SHORT_ID_PRICE), but the random pool
// used to include tier-priced IDs (8888/6666/1234/1000…) — a user could be
// charged 50,000 for a "random 1000" claim. Tier-priced IDs are now excluded
// from random draws, so a random claim can never be a premium ID.
// NOTE: server-side charge verification for random claims is still pending
// (out of client scope) — confirm VPS charges flat 1000 for random claims.
const PREMIUM_SHORT_IDS = new Set(Object.keys(SHORT_ID_PRICES));

/** Draw a random 4-digit ID that is NOT in any priced tier. */
function drawNonPremiumRandomId(): string {
  // Only ~0.15% of 4-digit IDs are tier-priced; bounded retry never spins.
  for (let i = 0; i < 100; i++) {
    const id = String(Math.floor(1000 + Math.random() * 9000));
    if (!PREMIUM_SHORT_IDS.has(id)) return id;
  }
  // Fallback (effectively unreachable): first non-premium ID in sequence.
  for (let n = 1000; n <= 9999; n++) {
    const id = String(n);
    if (!PREMIUM_SHORT_IDS.has(id)) return id;
  }
  return '1001'; // keeps tsc happy; unreachable
}

/**
 * Purchase a specific 4-digit short ID via the server (atomic).
 * @returns { success, error } — error is a user-friendly message.
 */
export async function purchaseShortId(
  kind: ShortIdKind,
  shortId: string,
  roomId?: string,
): Promise<{ success: boolean; error?: string; newBalance?: number }> {
  const user = auth.currentUser;
  if (!user) return { success: false, error: 'Not signed in' };

  if (!/^[0-9]{4}$/.test(shortId)) {
    return { success: false, error: 'ID must be 4 digits' };
  }
  if (kind === 'rooms' && !roomId) {
    return { success: false, error: 'Select a room first' };
  }

  try {
    const token = await user.getIdToken();
    const idempotencyKey = `${user.uid}_${shortId}_${Date.now()}`;
    const res = await fetch(`${getApiBase()}/api/wallet/purchase-short-id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ shortId, kind, roomId, idempotencyKey }),
    });
    const data = await res.json() as { ok?: boolean; error?: string; newBalance?: number };
    if (!res.ok || !data.ok) {
      return { success: false, error: data.error ?? 'Purchase failed' };
    }
    return { success: true, newBalance: data.newBalance };
  } catch {
    return { success: false, error: 'Network error' };
  }
}

/**
 * @deprecated Use purchaseShortId() instead. Kept for backwards compat;
 * now routes through the server (no direct writes).
 */
export async function claimShortId(
  kind: ShortIdKind,
  shortId: string,
  ownerId: string,
): Promise<{ success: boolean; error?: string }> {
  const roomId = kind === 'rooms' ? ownerId : undefined;
  return purchaseShortId(kind, shortId, roomId);
}

/**
 * Assign a random available 4-digit ID (1000-9999), flat-priced at 1000.
 * Tier-priced IDs are excluded from the pool (see PREMIUM_SHORT_IDS).
 * Retries up to 10 times to find an unclaimed ID.
 */
export async function claimRandomShortId(
  kind: ShortIdKind,
  ownerId: string,
): Promise<{ success: boolean; shortId?: string; error?: string }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomId = drawNonPremiumRandomId();
    const result = await claimShortId(kind, randomId, ownerId);
    if (result.success) {
      return { success: true, shortId: randomId };
    }
    // If taken, try another random ID
    if (result.error !== 'ID already taken') {
      return { success: false, error: result.error };
    }
  }
  return { success: false, error: 'Could not find available ID' };
}

/**
 * Check if a short ID is available.
 */
export async function isShortIdAvailable(
  kind: ShortIdKind,
  shortId: string,
): Promise<boolean> {
  const snap = await get(ref(database, `shortIds/${kind}/${shortId}`));
  return !snap.exists();
}

/**
 * Admin: grant a custom short ID (digits only, any length).
 *
 * REMOVED 2026-10-19 (CRASH-RISK audit): the client grant path was dead —
 * Firebase rules set ".write": "false" on shortIds/{users,rooms}, so no
 * client write can ever succeed here. Short IDs are granted via the admin
 * panel / VPS only. If an in-app admin grant is ever needed, it must go
 * through a server endpoint, never a direct client write.
 */

/**
 * Admin: grant official verified badge to a user.
 * Only works if the caller is in admins/{uid}.
 */
export async function adminGrantOfficialBadge(
  targetUid: string,
): Promise<{ success: boolean; error?: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { success: false, error: 'Not signed in' };

  try {
    await set(ref(database, `users/${targetUid}/officialBadge`), {
      grantedBy: uid,
      grantedAt: Date.now(),
    });
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to grant badge (not admin?)' };
  }
}

/**
 * Admin: revoke official verified badge.
 */
export async function adminRevokeOfficialBadge(
  targetUid: string,
): Promise<{ success: boolean; error?: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { success: false, error: 'Not signed in' };

  try {
    await set(ref(database, `users/${targetUid}/officialBadge`), null);
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to revoke badge' };
  }
}

/**
 * Check if the current user is an admin.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  const snap = await get(ref(database, `admins/${uid}`));
  return snap.exists();
}

/**
 * Look up a user UID by short ID (for search).
 */
export async function lookupUserByShortId(shortId: string): Promise<string | null> {
  const snap = await get(ref(database, `shortIds/users/${shortId}`));
  return snap.exists() ? (snap.val() as string) : null;
}

/**
 * Look up a room ID by short ID (for search).
 */
export async function lookupRoomByShortId(shortId: string): Promise<string | null> {
  const snap = await get(ref(database, `shortIds/rooms/${shortId}`));
  return snap.exists() ? (snap.val() as string) : null;
}
