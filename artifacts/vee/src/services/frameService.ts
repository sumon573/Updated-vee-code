import { ref, set, remove } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * Frame equip/unequip service.
 * 2026-10-13 (Sumon): Use = frame shows on DP (profile + rooms).
 * Remove = frame hidden. Only one frame active at a time.
 */

/** Equip a frame — sets users/{uid}/activeFrame */
export async function equipFrame(uid: string, frameId: string): Promise<void> {
  await set(ref(database, `users/${uid}/activeFrame`), frameId);
}

/** Unequip — removes activeFrame, DP shows without frame */
export async function unequipFrame(uid: string): Promise<void> {
  await remove(ref(database, `users/${uid}/activeFrame`));
}
