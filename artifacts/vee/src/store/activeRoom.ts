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
  /** 2026-10-26 (mic durability): last self mic intent, when known. */
  muted?: boolean;
};

const KEY = 'vee_active_room_v1';

export async function persistActiveRoom(room: {
  roomId: string;
  myUid: string;
  mySeatIdx: number;
  muted?: boolean;
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
      muted: typeof p.muted === 'boolean' ? p.muted : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 2026-10-26 (mic durability): the user's OWN mic intent, durable across
 * app kills. Written ONLY from user-tap paths (room mic button, minimized
 * bar toggle) and explicit-unmute sites (seat take, invite accept) — NEVER
 * from host-mute enforcement or seat-sync enforcement, so it is always
 * the user's own choice, never a default and never the host's mute.
 * Read on cold start to seed a fresh engine before join.
 */
const MIC_INTENT_KEY = 'vee_mic_intent_v1';

export async function persistMicIntent(roomId: string, muted: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(MIC_INTENT_KEY, JSON.stringify({ roomId, muted, ts: Date.now() }));
  } catch {
    // non-critical — restore is best-effort
  }
}

export async function getMicIntent(): Promise<{ roomId: string; muted: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem(MIC_INTENT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<{ roomId: string; muted: boolean }>;
    if (!p.roomId || typeof p.muted !== 'boolean') return null;
    return { roomId: p.roomId, muted: p.muted };
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
