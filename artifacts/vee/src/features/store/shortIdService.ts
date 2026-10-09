/**
 * Short ID Service — claim, random assign, admin grant (2026-10-09).
 *
 * - Users: shortIds/users/{id} → uid, users/{uid}/shortId → id
 * - Rooms: shortIds/rooms/{id} → roomId, rooms/{roomId}/info/shortId → id
 *
 * Claim uses a Firebase transaction for atomic uniqueness: if two users
 * race for the same ID, only the first transaction commits.
 */

import { ref, runTransaction, get, set } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';

export type ShortIdKind = 'users' | 'rooms';

/**
 * Claim a specific 4-digit short ID.
 * @returns { success, error } — error is a user-friendly message key.
 */
export async function claimShortId(
  kind: ShortIdKind,
  shortId: string,
  ownerId: string, // uid for users, roomId for rooms
): Promise<{ success: boolean; error?: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { success: false, error: 'Not signed in' };

  // Validate: digits only, 4 digits for store purchases
  if (!/^[0-9]{4}$/.test(shortId)) {
    return { success: false, error: 'ID must be 4 digits' };
  }

  const registryRef = ref(database, `shortIds/${kind}/${shortId}`);

  // Atomic claim via transaction
  const result = await runTransaction(registryRef, (current) => {
    if (current !== null) {
      // Already taken — abort
      return undefined;
    }
    return ownerId;
  });

  if (!result.committed) {
    return { success: false, error: 'ID already taken' };
  }

  // Write the reverse mapping
  try {
    if (kind === 'users') {
      await set(ref(database, `users/${ownerId}/shortId`), shortId);
    } else {
      await set(ref(database, `rooms/${ownerId}/info/shortId`), shortId);
    }
  } catch {
    // Rollback the registry on failure
    await set(registryRef, null).catch(() => {});
    return { success: false, error: 'Failed to save ID' };
  }

  return { success: true };
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
