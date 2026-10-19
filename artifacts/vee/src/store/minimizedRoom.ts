/**
 * minimizedRoom.ts
 * Simple in-memory store for the currently minimized voice room.
 * Components subscribe to changes via subscribeMinimizedRoom().
 */

export type MinimizedRoom = {
  id: string;
  name: string;
  topic: string;
  /** UID of the minimizing user — needed for Firebase cleanup on close. */
  myUid: string;
  /** Seat index of the minimizing user (-1 if they are in the audience). */
  mySeatIdx: number;
  /** Whether the user's mic was muted at the time of minimize. */
  muted: boolean;
  /** The user's room role at minimize time — needed to revoke admin powers
   * if the seat is torn down while opening a different room (2026-10-12). */
  role?: string;
  /** Room cover image URL — shown as the DP in the mini-player bar (2026-10-11). */
  coverImageUrl?: string;
} | null;

let _minimizedRoom: MinimizedRoom = null;
let _listeners: Array<(room: MinimizedRoom) => void> = [];

export function setMinimizedRoom(room: MinimizedRoom) {
  _minimizedRoom = room;
  _listeners.forEach((l) => l(room));
}

export function getMinimizedRoom(): MinimizedRoom {
  return _minimizedRoom;
}

export function subscribeMinimizedRoom(
  listener: (room: MinimizedRoom) => void,
): () => void {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

/* ── current-room API (2026-10-14 design, restored 2026-10-19) ──
 * Tracks the actively-open voice room separately from the minimized one.
 * setCurrentRoom accepts the minimal {id, myUid, mySeatIdx} shape used by
 * call sites; remaining MinimizedRoom fields default sensibly. */

let _currentRoom: MinimizedRoom = null;

export function setCurrentRoom(room: { id: string; myUid: string; mySeatIdx: number }): void {
  _currentRoom = {
    id: room.id,
    name: '',
    topic: '',
    myUid: room.myUid,
    mySeatIdx: room.mySeatIdx,
    muted: false,
  };
}

export function getCurrentRoom(): MinimizedRoom {
  return _currentRoom;
}

export function clearCurrentRoom(): void {
  _currentRoom = null;
}
