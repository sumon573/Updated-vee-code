import { ref, get } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * Check if a user has the Vee Official badge.
 * 2026-10-13 (Sumon): Used to show Vee logo next to name everywhere.
 */
export async function hasOfficialBadge(uid: string): Promise<boolean> {
  try {
    // Check officialBadge field first (legacy)
    const officialSnap = await get(ref(database, `users/${uid}/officialBadge`));
    if (officialSnap.exists()) return true;

    // Check badges node for Vee Official
    const badgesSnap = await get(ref(database, `users/${uid}/badges`));
    if (!badgesSnap.exists()) return false;
    const badges = badgesSnap.val() as Record<string, any>;
    return Object.values(badges).some(
      (b: any) => (b.name || '').toLowerCase().includes('vee official')
    );
  } catch {
    return false;
  }
}
