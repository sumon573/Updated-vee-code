/**
 * Firebase Audio Call Service — RC6 Issue 8 fix
 *
 * Provides signaling for 1-to-1 audio calls via Firebase Realtime Database.
 *
 * DB Structure:
 *   calls/{calleeUid} → IncomingCall  (written by caller, removed on accept/decline)
 *
 * Flow:
 *   Caller  → initiateCall(calleeUid, ...) → writes calls/{calleeUid}
 *   Callee  → sees incoming call via subscribeIncomingCall
 *   Callee  → accepts → acceptCall() removes the node → navigates to AudioCallScreen
 *   Callee  → declines → declineCall() removes the node
 *   Caller  → on timeout or manual end → cancelCall() removes the node + leaves the call
 */

import { ref, set, remove, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { sendPushNotification } from '@/src/services/notifyService';

// ─── Types ───────────────────────────────────────────────────────────────────

export type IncomingCall = {
  callerId: string;
  callerName: string;
  callerPhotoURL?: string;
  roomId: string;
  createdAt: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Deterministic call room ID from two UIDs.
 * Both parties compute the same ID independently.
 */
export function buildCallRoomId(uidA: string, uidB: string): string {
  return `ac_${[uidA, uidB].sort().join('_')}`;
}

// ─── Signaling ────────────────────────────────────────────────────────────────

/**
 * Write an incoming call signal to the callee's `calls/{calleeUid}` node.
 * Call this from the caller's side immediately before starting the WebRTC session.
 */
export async function initiateCall(
  calleeUid: string,
  data: Omit<IncomingCall, 'createdAt'>,
): Promise<void> {
  await set(ref(database, `calls/${calleeUid}`), {
    ...data,
    createdAt: Date.now(),
  });
  // Push notification so the callee's phone rings even if the app is
  // closed/backgrounded. The incoming-call screen opens via the click handler.
  sendPushNotification(
    calleeUid,
    data.callerName || 'Vee',
    '📞 Incoming audio call — tap to answer',
    {
      type: 'incoming-call',
      callerUid: data.callerId,
      callerName: data.callerName,
      callerAvatar: data.callerPhotoURL,
      roomId: data.roomId,
    },
    'voiceRooms',
  );
}

/**
 * Remove the call signal — used by the callee on accept, or by either party
 * on decline/cancel/timeout. Safe to call even if the node doesn't exist.
 */
export async function removeCallSignal(calleeUid: string): Promise<void> {
  await remove(ref(database, `calls/${calleeUid}`));
}

/**
 * Mark the call as REJECTED before removing the signal, so the caller
 * can distinguish "declined" from "timeout/no-answer". The caller watches
 * `calls/{calleeUid}/status` during ringing.
 */
export async function rejectCallSignal(calleeUid: string): Promise<void> {
  try {
    await set(ref(database, `calls/${calleeUid}/status`), 'rejected');
  } catch { /* fall through to remove */ }
  // Small delay so the caller's listener sees 'rejected' before deletion.
  await new Promise(r => setTimeout(r, 800));
  await remove(ref(database, `calls/${calleeUid}`)).catch(() => {});
}

/**
 * Subscribe to incoming calls for a given user (real-time).
 * Returns an unsubscribe function.
 */
export function subscribeIncomingCall(
  uid: string,
  callback: (call: IncomingCall | null) => void,
): () => void {
  return onValue(
    ref(database, `calls/${uid}`),
    (snap) => {
      callback(snap.exists() ? (snap.val() as IncomingCall) : null);
    },
    () => callback(null),
  );
}
