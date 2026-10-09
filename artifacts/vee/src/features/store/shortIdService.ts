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

import { ref, get, runTransaction, set } from 'firebase/database';
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
 * Assign a random available 4-digit ID (1000-9999).
 * Retries up to 10 times to find an unclaimed ID.
 */
export async function claimRandomShortId(
  kind: ShortIdKind,
  ownerId: string,
): Promise<{ success: boolean; shortId?: string; error?: string }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const randomId = String(Math.floor(1000 + Math.random() * 9000));
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
 * Only works if the caller is in admins/{uid} (enforced by Firebase rules).
 */
export async function adminGrantShortId(
  kind: ShortIdKind,
  shortId: string,
  ownerId: string,
): Promise<{ success: boolean; error?: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { success: false, error: 'Not signed in' };

  // Digits only, 1-8 digits (admin can grant any length)
  if (!/^[0-9]{1,8}$/.test(shortId)) {
    return { success: false, error: 'ID must be digits only' };
  }

  const registryRef = ref(database, `shortIds/${kind}/${shortId}`);

  // Admin can overwrite (rules allow admins to write even if taken)
  const result = await runTransaction(registryRef, () => ownerId);

  if (!result.committed) {
    return { success: false, error: 'Failed to grant ID' };
  }

  try {
    if (kind === 'users') {
      await set(ref(database, `users/${ownerId}/shortId`), shortId);
    } else {
      await set(ref(database, `rooms/${ownerId}/info/shortId`), shortId);
    }
  } catch {
    return { success: false, error: 'Failed to save ID' };
  }

  return { success: true };
}

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
