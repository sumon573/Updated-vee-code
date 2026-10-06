/**
 * Block Service — Firebase Realtime Database
 *
 * DB Structure:
 *   userBlocks/{myUid}/{targetUid} → BlockRecord
 *
 * This is a user-level block (different from room-level roomBlocks).
 * Blocked users cannot send messages or view profile.
 */

import { ref, set, remove, get, onValue } from 'firebase/database';
import { database } from '../config/firebase';

export type BlockRecord = {
  targetUid: string;
  targetName: string;
  targetAvatar?: string;
  blockedAt: number;
};

/** Block a user globally. */
export async function blockUser(
  myUid: string,
  targetUid: string,
  targetName: string,
  targetAvatar?: string,
): Promise<void> {
  const record: BlockRecord = {
    targetUid,
    targetName,
    ...(targetAvatar ? { targetAvatar } : {}),
    blockedAt: Date.now(),
  };
  await set(ref(database, `userBlocks/${myUid}/${targetUid}`), record);
}

/** Unblock a user. */
export async function unblockUser(myUid: string, targetUid: string): Promise<void> {
  await remove(ref(database, `userBlocks/${myUid}/${targetUid}`));
}

/** One-time check: have I blocked this user? */
export async function isBlockedByMe(myUid: string, targetUid: string): Promise<boolean> {
  const snap = await get(ref(database, `userBlocks/${myUid}/${targetUid}`));
  return snap.exists();
}

/** Subscribe to my blocked users list in real-time. */
export function subscribeBlockedUsers(
  myUid: string,
  callback: (blocks: BlockRecord[]) => void,
): () => void {
  return onValue(
    ref(database, `userBlocks/${myUid}`),
    (snap) => {
      if (!snap.exists()) { callback([]); return; }
      const records: BlockRecord[] = [];
      snap.forEach((child) => {
        records.push(child.val() as BlockRecord);
      });
      records.sort((a, b) => b.blockedAt - a.blockedAt);
      callback(records);
    },
    () => { callback([]); },
  );
}

/** Check if the other user blocked me. */
export async function isBlockedByThem(myUid: string, targetUid: string): Promise<boolean> {
  const snap = await get(ref(database, `userBlocks/${targetUid}/${myUid}`));
  return snap.exists();
}

export type BlockDirection = 'none' | 'byMe' | 'byThem' | 'mutual';

/**
 * Check block status in both directions.
 * Returns 'byMe' if I blocked them, 'byThem' if they blocked me,
 * 'mutual' if both, 'none' if neither.
 */
export async function getBlockDirection(myUid: string, targetUid: string): Promise<BlockDirection> {
  const [byMe, byThem] = await Promise.all([
    isBlockedByMe(myUid, targetUid),
    isBlockedByThem(myUid, targetUid),
  ]);
  if (byMe && byThem) return 'mutual';
  if (byMe) return 'byMe';
  if (byThem) return 'byThem';
  return 'none';
}

/** True if messaging/calling is forbidden in either direction. */
export async function isInteractionBlocked(myUid: string, targetUid: string): Promise<boolean> {
  return (await getBlockDirection(myUid, targetUid)) !== 'none';
}

/** Error thrown when trying to interact with a blocked user. */
export class BlockedInteractionError extends Error {
  direction: BlockDirection;
  constructor(direction: BlockDirection) {
    super(direction === 'byMe' ? 'You have blocked this user' : 'This user has blocked you');
    this.name = 'BlockedInteractionError';
    this.direction = direction;
  }
}
