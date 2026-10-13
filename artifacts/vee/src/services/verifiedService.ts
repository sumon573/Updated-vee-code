import { ref, get } from 'firebase/database';
import { database } from '../config/firebase';

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
