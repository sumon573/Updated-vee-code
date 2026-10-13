import { ref, get } from 'firebase/database';
import { database } from '../config/firebase';

// Cache for the official badge icon URL (server-driven, no app update needed)
let badgeIconCache: string | null = null;
let badgeIconPromise: Promise<string | null> | null = null;

/**
 * 2026-10-13 (Sumon): SERVER-DRIVEN badge icon.
 * Fetches the Vee Official badge icon URL from honors_catalog.
 * When Sumon updates the badge in admin panel, ALL apps show the new icon instantly — no app update needed.
 * Falls back to null (caller uses bundled asset) if fetch fails.
 */
export async function getOfficialBadgeIconUrl(): Promise<string | null> {
  if (badgeIconCache) return badgeIconCache;
  if (badgeIconPromise) return badgeIconPromise;

  badgeIconPromise = (async () => {
    try {
      // Find the Vee Official badge in catalog (Special/official)
      const snap = await get(ref(database, 'honors_catalog'));
      if (!snap.exists()) return null;
      const catalog = snap.val() as Record<string, any>;
      for (const item of Object.values(catalog)) {
        const name = (item.name || '').toLowerCase();
        const isOfficial = name.includes('vee official') && item.type === 'badge';
        if (isOfficial && item.icon && typeof item.icon === 'string' && item.icon.startsWith('http')) {
          badgeIconCache = item.icon;
          return item.icon;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      badgeIconPromise = null;
    }
  })();

  return badgeIconPromise;
}

/**
 * Clear the badge icon cache (call after admin updates the icon)
 */
export function clearBadgeIconCache() {
  badgeIconCache = null;
}

/**
 * Check if a user has a VALID (non-expired) Vee Official badge.
 * 2026-10-13 (Sumon): Used to show Vee logo next to name everywhere.
 * The logo shows only for the duration of the badge's validity.
 */
export async function hasOfficialBadge(uid: string): Promise<boolean> {
  try {
    // Check officialBadge field first (legacy)
    const officialSnap = await get(ref(database, `users/${uid}/officialBadge`));
    if (officialSnap.exists()) return true;

    // Check badges node for Vee Official with valid (non-expired) validity
    const badgesSnap = await get(ref(database, `users/${uid}/badges`));
    if (!badgesSnap.exists()) return false;
    const badges = badgesSnap.val() as Record<string, any>;
    const now = Date.now();
    return Object.values(badges).some((b: any) => {
      const isOfficial = (b.name || '').toLowerCase().includes('vee official');
      if (!isOfficial) return false;
      // Check validity: permanent = always valid; timestamp = valid if in future
      if (b.validity === 'permanent' || !b.validity) return true;
      const expiry = typeof b.validity === 'number' ? b.validity : b.expiresAt;
      return typeof expiry === 'number' ? expiry > now : true;
    });
  } catch {
    return false;
  }
}
