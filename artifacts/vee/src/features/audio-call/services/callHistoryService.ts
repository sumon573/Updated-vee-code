/**
 * callHistoryService — call history log (2026-10-19).
 * Firebase node: callHistory/{uid}/{pushId} → CallHistoryEntry.
 *
 * Reader + writer API. The writer (logCall) is meant to be called on call
 * end (completed/missed/declined) by the call-screen owner; this service
 * itself does not touch call UI.
 */
import { ref, onValue, push, set, query, orderByChild, limitToLast } from 'firebase/database';
import { database } from '@/src/config/firebase';

export type CallDirection = 'incoming' | 'outgoing';
export type CallStatus = 'completed' | 'missed' | 'declined' | 'cancelled';

export type CallHistoryEntry = {
  id: string;
  remoteUid: string;
  remoteName: string;
  remotePhotoURL?: string | null;
  direction: CallDirection;
  status: CallStatus;
  startedAt: number;
  durationSec?: number;
};

/**
 * Subscribe to the user's call history, newest first.
 * Returns the Firebase unsubscribe function.
 */
export function subscribeCallHistory(
  uid: string,
  cb: (entries: CallHistoryEntry[]) => void,
  limit = 100,
): () => void {
  const q = query(
    ref(database, `callHistory/${uid}`),
    orderByChild('startedAt'),
    limitToLast(limit),
  );
  return onValue(q, (snap) => {
    const list: CallHistoryEntry[] = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const v = child.val() as Omit<CallHistoryEntry, 'id'>;
        list.push({ ...(v as CallHistoryEntry), id: child.key || '' });
      });
    }
    list.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    cb(list);
  });
}

/**
 * Log a finished call. Call with direction/status/duration at call end.
 */
export async function logCall(
  uid: string,
  entry: Omit<CallHistoryEntry, 'id'>,
): Promise<void> {
  const node = push(ref(database, `callHistory/${uid}`));
  await set(node, entry);
}
