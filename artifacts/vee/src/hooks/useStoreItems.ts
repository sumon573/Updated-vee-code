/**
 * useStoreItems.ts — real-time hooks for equipped store items (2026-10-16, Sumon).
 *
 * Same BETTER ARCHITECTURE as useActiveFrame (2026-10-14): components listen
 * DIRECTLY to the source node — no stale copies, changes reflect live.
 */

import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';
import type { EquippedItem } from '../features/store/storeService';

function sanitizeEquipped(raw: any): EquippedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.itemId !== 'string' || !raw.itemId) return null;
  if (typeof raw.imageUrl !== 'string' || !raw.imageUrl) return null;
  if (typeof raw.expiresAt === 'number' && raw.expiresAt <= Date.now()) return null;
  return {
    itemId: raw.itemId,
    imageUrl: raw.imageUrl,
    name: typeof raw.name === 'string' ? raw.name : '',
    ...(typeof raw.expiresAt === 'number' ? { expiresAt: raw.expiresAt } : {}),
  };
}

function useEquippedNode(uid: string | undefined | null, node: string): EquippedItem | null {
  const [item, setItem] = useState<EquippedItem | null>(null);
  useEffect(() => {
    if (!uid) {
      setItem(null);
      return;
    }
    const unsub = onValue(ref(database, `users/${uid}/${node}`), (snap) => {
      setItem(sanitizeEquipped(snap.val()));
    });
    return () => unsub();
  }, [uid, node]);
  return item;
}

/** 2026-10-16: equipped mic sticker — renders as a badge on the voice-room seat. */
export function useActiveMicSticker(uid: string | undefined | null): EquippedItem | null {
  return useEquippedNode(uid, 'activeMicSticker');
}

/** 2026-10-16: equipped profile skin — renders as the profile screen background. */
export function useActiveProfileSkin(uid: string | undefined | null): EquippedItem | null {
  return useEquippedNode(uid, 'activeProfileSkin');
}

export interface RoomDecor {
  backgroundUrl: string | null;
  micDecorUrl: string | null;
}

/**
 * 2026-10-16: room-level store decor — background + mic decor for a room.
 * Reads rooms/{roomId}/storeBackground and rooms/{roomId}/activeMicDecor.
 */
export function useStoreRoomDecor(roomId: string | undefined | null): RoomDecor {
  const [decor, setDecor] = useState<RoomDecor>({ backgroundUrl: null, micDecorUrl: null });
  useEffect(() => {
    if (!roomId) {
      setDecor({ backgroundUrl: null, micDecorUrl: null });
      return;
    }
    const unsubBg = onValue(ref(database, `rooms/${roomId}/storeBackground`), (snap) => {
      const v = snap.val();
      const ok = v && typeof v.imageUrl === 'string' && v.imageUrl &&
        (typeof v.expiresAt !== 'number' || v.expiresAt > Date.now());
      setDecor((d) => ({ ...d, backgroundUrl: ok ? v.imageUrl : null }));
    });
    const unsubMic = onValue(ref(database, `rooms/${roomId}/activeMicDecor`), (snap) => {
      const v = sanitizeEquipped(snap.val());
      setDecor((d) => ({ ...d, micDecorUrl: v ? v.imageUrl : null }));
    });
    return () => {
      unsubBg();
      unsubMic();
    };
  }, [roomId]);
  return decor;
}
