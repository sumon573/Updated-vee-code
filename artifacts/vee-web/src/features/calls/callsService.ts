/**
 * Call invite signaling (`calls/{calleeUid}`) — mirrors the native app's
 * invite flow so web ↔ native calls ring on both sides.
 *
 * Contract shapes:
 *   calls/{calleeUid} → { callerId, callerName, callerPhotoURL?, roomId, createdAt }
 *   roomId            → buildCallRoomId(callerUid, calleeUid) (deterministic)
 */

import { ref, set, remove, onValue } from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { buildCallRoomId } from './callRoom';

export type IncomingCall = {
  callerId: string;
  callerName: string;
  callerPhotoURL?: string;
  roomId: string;
  createdAt: number;
};

/** Caller: ring the callee before starting WebRTC as the offerer. */
export async function sendCallInvite(
  calleeUid: string,
  callerId: string,
  callerName: string,
  callerPhotoURL?: string,
): Promise<void> {
  const invite: IncomingCall = {
    callerId,
    callerName,
    roomId: buildCallRoomId(callerId, calleeUid),
    createdAt: Date.now(),
    ...(callerPhotoURL ? { callerPhotoURL } : {}),
  };
  await set(ref(rtdb, `calls/${calleeUid}`), invite);
}

/** Caller: retract the invite (cancel / timeout). Callee: consume the invite. */
export async function cancelCallInvite(calleeUid: string): Promise<void> {
  await remove(ref(rtdb, `calls/${calleeUid}`)).catch(() => {
    /* non-critical — invite may already be gone */
  });
}

/**
 * Callee: subscribe to the incoming-call node. Fires immediately with the
 * current invite (or null) and on every change. Caller-side callers should
 * ignore invites addressed to themselves.
 */
export function subscribeIncomingCall(
  myUid: string,
  callback: (invite: IncomingCall | null) => void,
): () => void {
  return onValue(
    ref(rtdb, `calls/${myUid}`),
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const v = snap.val() as Partial<IncomingCall>;
      if (!v || typeof v.callerId !== 'string' || typeof v.roomId !== 'string') {
        callback(null);
        return;
      }
      callback({
        callerId: v.callerId,
        callerName: typeof v.callerName === 'string' ? v.callerName : 'Unknown',
        callerPhotoURL: typeof v.callerPhotoURL === 'string' ? v.callerPhotoURL : undefined,
        roomId: v.roomId,
        createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
      });
    },
    () => callback(null),
  );
}
