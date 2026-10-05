/**
 * RTDB room service — web port of the native `firebaseRoomService.ts` seat /
 * audience operations, mirroring its behavior exactly:
 *
 *  - takeSeat uses a runTransaction so two users racing for the same empty
 *    seat can't both win (loser gets `success: false`).
 *  - Winning a seat registers an `onDisconnect(...).remove()` for the seat
 *    and cancels the audience one, so crashes don't leave ghosts.
 *  - leaveSeat / leaveAudience cancel pending onDisconnect handlers first.
 *  - `muted` on a seat is the authority for host-driven mute; the target
 *    client watches it and mutes its local mic to match.
 *  - Host-side "mute remote" = unsubscribe from the participant's audio
 *    locally (done in the voice hook), NOT a track change.
 *  - Rooms are NEVER auto-closed client-side.
 */

import {
  get,
  limitToLast,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  query,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type DataSnapshot,
} from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { SEAT_COUNT } from './types';
import type { RoomAudienceMember, RoomInfoShape, RoomSeat } from './types';

const seatsRef = (roomId: string) => ref(rtdb, `rooms/${roomId}/seats`);
const seatRef = (roomId: string, idx: number) => ref(rtdb, `rooms/${roomId}/seats/${idx}`);
const audienceRef = (roomId: string, uid: string) => ref(rtdb, `rooms/${roomId}/audience/${uid}`);

/* ─── Subscriptions ─────────────────────────────────────────────────────── */

/** Subscribe to all seats (array of SEAT_COUNT, nulls for empty). */
export function subscribeSeats(
  roomId: string,
  callback: (seats: Array<RoomSeat | null>) => void,
): () => void {
  return onValue(
    seatsRef(roomId),
    (snap: DataSnapshot) => {
      const seats: Array<RoomSeat | null> = Array<RoomSeat | null>(SEAT_COUNT).fill(null);
      snap.forEach((child) => {
        const idx = Number(child.key);
        if (Number.isInteger(idx) && idx >= 0 && idx < SEAT_COUNT) {
          seats[idx] = child.val() as RoomSeat;
        }
        return undefined;
      });
      callback(seats);
    },
    () => {
      callback(Array<RoomSeat | null>(SEAT_COUNT).fill(null));
    },
  );
}

/** Subscribe to the audience list (listeners). */
export function subscribeAudience(
  roomId: string,
  callback: (members: RoomAudienceMember[]) => void,
): () => void {
  return onValue(
    ref(rtdb, `rooms/${roomId}/audience`),
    (snap: DataSnapshot) => {
      const list: RoomAudienceMember[] = [];
      snap.forEach((child) => {
        list.push(child.val() as RoomAudienceMember);
        return undefined;
      });
      callback(list);
    },
    () => {
      callback([]);
    },
  );
}

/** Subscribe to locked seats (Set of indices). */
export function subscribeLockedSeats(
  roomId: string,
  callback: (locked: Set<number>) => void,
): () => void {
  return onValue(
    ref(rtdb, `rooms/${roomId}/lockedSeats`),
    (snap: DataSnapshot) => {
      const locked = new Set<number>();
      snap.forEach((child) => {
        const idx = Number(child.key);
        if (Number.isInteger(idx)) locked.add(idx);
        return undefined;
      });
      callback(locked);
    },
    () => {
      callback(new Set());
    },
  );
}

/** Subscribe to the room info node. */
export function subscribeRoomInfo(
  roomId: string,
  callback: (info: RoomInfoShape | null) => void,
): () => void {
  return onValue(
    ref(rtdb, `rooms/${roomId}/info`),
    (snap: DataSnapshot) => {
      callback(snap.exists() ? (snap.val() as RoomInfoShape) : null);
    },
    () => {
      callback(null);
    },
  );
}

/* ─── Audience ──────────────────────────────────────────────────────────── */

/** Add user to the audience when they enter the room. */
export async function joinRoomAsAudience(
  roomId: string,
  member: RoomAudienceMember,
): Promise<void> {
  const aRef = audienceRef(roomId, member.userId);
  await set(aRef, member);
  // Crash-safe: a dropped connection removes the audience entry so the room
  // doesn't show ghost members. The room itself is never touched.
  onDisconnect(aRef).remove().catch(() => {
    // non-critical
  });
}

/** Remove user from the audience. */
export async function leaveAudience(roomId: string, userId: string): Promise<void> {
  const aRef = audienceRef(roomId, userId);
  onDisconnect(aRef).cancel().catch(() => {
    // non-critical
  });
  await remove(aRef);
}

/* ─── Seats ─────────────────────────────────────────────────────────────── */

/**
 * User takes a seat (moves from audience to seat).
 * RTDB transaction: two users racing for the same empty seat can't both
 * win — the first writer commits, the second is rejected (`success: false`).
 */
export async function takeSeat(
  roomId: string,
  seatIndex: number,
  member: RoomSeat,
): Promise<{ success: boolean }> {
  const sRef = seatRef(roomId, seatIndex);
  const result = await runTransaction(sRef, (current: unknown) => {
    if (current !== null) {
      // Seat already taken by someone else — abort the transaction.
      return undefined;
    }
    return member;
  });

  if (!result.committed) {
    return { success: false };
  }

  // Seat won — cancel the audience onDisconnect, remove the audience entry,
  // and register an onDisconnect for the seat so a dropped connection frees
  // the seat rather than leaving a ghost.
  const aRef = audienceRef(roomId, member.userId);
  onDisconnect(aRef).cancel().catch(() => {
    // non-critical
  });
  await remove(aRef);
  onDisconnect(sRef).remove().catch(() => {
    // non-critical
  });
  return { success: true };
}

/** User leaves their seat (goes back to the audience). */
export async function leaveSeat(
  roomId: string,
  seatIndex: number,
  userId: string,
  audienceMember?: RoomAudienceMember,
): Promise<void> {
  const sRef = seatRef(roomId, seatIndex);
  onDisconnect(sRef).cancel().catch(() => {
    // non-critical
  });

  const ops: Array<Promise<void>> = [remove(sRef)];
  if (audienceMember) {
    const aRef = audienceRef(roomId, userId);
    ops.push(set(aRef, audienceMember));
    onDisconnect(aRef).remove().catch(() => {
      // non-critical
    });
  }
  await Promise.all(ops);
}

/** Remove a member from a seat (host kick). */
export async function removeSeat(roomId: string, seatIndex: number): Promise<void> {
  const sRef = seatRef(roomId, seatIndex);
  onDisconnect(sRef).cancel().catch(() => {
    // non-critical
  });
  await remove(sRef);
}

/** Toggle mute on a seat — the authority for host-driven mute. */
export async function setSeatMute(
  roomId: string,
  seatIndex: number,
  muted: boolean,
): Promise<void> {
  await update(seatRef(roomId, seatIndex), { muted });
}

/** Lock a seat so nobody can take it (owner/admin). */
export async function lockSeat(roomId: string, seatIndex: number): Promise<void> {
  await set(ref(rtdb, `rooms/${roomId}/lockedSeats/${seatIndex}`), true);
}

/** Unlock a seat (owner/admin). */
export async function unlockSeat(roomId: string, seatIndex: number): Promise<void> {
  await remove(ref(rtdb, `rooms/${roomId}/lockedSeats/${seatIndex}`));
}

/** Audience member requests to take a specific seat (host approves/denies). */
export async function sendSeatRequest(
  roomId: string,
  request: {
    userId: string;
    userName: string;
    initials: string;
    color: string;
    seatIdx: number;
    ts: number;
    hostId: string;
  },
): Promise<void> {
  const listRef = ref(rtdb, `roomSeatRequests/${roomId}`);
  const newRef = push(listRef);
  await set(newRef, {
    id: newRef.key,
    status: 'pending',
    ...request,
  });
}

/** Check whether the user is blocked from this room (refuse join client-side). */
export async function isBlockedFromRoom(roomId: string, uid: string): Promise<boolean> {
  try {
    const snap = await get(ref(rtdb, `roomBlocks/${roomId}/${uid}`));
    return snap.exists();
  } catch {
    return false;
  }
}

/* ─── Gift feed ─────────────────────────────────────────────────────────── */

/**
 * Subscribe to NEW gift feed entries (`rooms/{roomId}/giftFeed`).
 * Stale replays (ts older than `sinceTs`) are skipped — mirrors the native
 * GiftReceiveBanners behavior.
 */
export function subscribeGiftFeed(
  roomId: string,
  sinceTs: number,
  onEntry: (key: string, entry: unknown) => void,
): () => void {
  const q = query(ref(rtdb, `rooms/${roomId}/giftFeed`), limitToLast(30));
  return onChildAdded(q, (snap: DataSnapshot) => {
    try {
      const key = snap.key;
      if (!key) return;
      const val = snap.val() as Record<string, unknown> | null;
      const ts = typeof val?.ts === 'number' ? val.ts : 0;
      if (ts < sinceTs) return; // stale replay — skip
      onEntry(key, snap.val());
    } catch {
      // never let a feed entry crash the room
    }
  });
}
