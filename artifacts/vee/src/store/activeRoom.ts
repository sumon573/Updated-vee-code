/**
 * activeRoom.ts
 * 2026-10-15 (Sumon): AsyncStorage-persisted "active voice room".
 *
 * Problem: the app kept the active room only in memory (minimizedRoom.ts).
 * If Android killed the app during a long background, the room was forgotten —
 * reopening the app never returned the user to their voice room, and the
 * Firebase presence (wiped by onDisconnect) was never re-registered, so the
 * member count showed 0 even with the user inside.
 *
 * This store persists { roomId, myUid, mySeatIdx } across app kills:
 *  - written on room join / seat take,
 *  - cleared on explicit leave/exit,
 *  - read on cold start to auto-return the user to their room.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PersistedActiveRoom = {
  roomId: string;
  myUid: string;
  /** Seat index the user holds (-1 = audience). */
  mySeatIdx: number;
  /** When the entry was written (ms epoch). */
  ts: number;
};

const KEY = 'vee_active_room_v1';

export async function persistActiveRoom(room: {
  roomId: string;
  myUid: string;
  mySeatIdx: number;
}): Promise<void> {
  try {
    const payload: PersistedActiveRoom = { ...room, ts: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // non-critical — restore is best-effort
  }
}

export async function getPersistedActiveRoom(): Promise<PersistedActiveRoom | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedActiveRoom>;
    if (!p.roomId || !p.myUid) return null;
    return {
      roomId: p.roomId,
      myUid: p.myUid,
      mySeatIdx: typeof p.mySeatIdx === 'number' ? p.mySeatIdx : -1,
      ts: typeof p.ts === 'number' ? p.ts : 0,
    };
  } catch {
    return null;
  }
}

export async function clearPersistedActiveRoom(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // non-critical
  }
}
