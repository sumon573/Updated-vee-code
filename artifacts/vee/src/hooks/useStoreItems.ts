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

function sameEquipped(a: EquippedItem | null, b: EquippedItem | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.itemId === b.itemId && a.imageUrl === b.imageUrl
    && a.name === b.name && a.expiresAt === b.expiresAt;
}

interface EquippedEntry {
  value: EquippedItem | null;
  refCount: number;
  listeners: Set<(v: EquippedItem | null) => void>;
  unsub: (() => void) | null;
}

/**
 * 2026-10-22 (perf audit): ref-counted shared subscription cache, keyed by
 * `${uid}/${node}` — the useLiveUserProfile pattern. Every seat card used
 * to attach its own listener per equipped node; now one subscription per
 * (uid, node) serves all components, with change-only notifications.
 */
const equippedCache = new Map<string, EquippedEntry>();

function ensureEquippedSubscription(uid: string, node: string): EquippedEntry {
  const cacheKey = `${uid}/${node}`;
  const existing = equippedCache.get(cacheKey);
  if (existing) return existing;

  const entry: EquippedEntry = {
    value: null,
    refCount: 0,
    listeners: new Set(),
    unsub: null,
  };

  entry.unsub = onValue(ref(database, `users/${uid}/${node}`), (snap) => {
    const next = sanitizeEquipped(snap.val());
    if (!sameEquipped(next, entry.value)) {
      entry.value = next;
      for (const cb of entry.listeners) {
        try { cb(next); } catch { /* one bad listener must not break the rest */ }
      }
    }
  }, () => {
    // Fall back to empty (no equipped item) instead of a silently dead listener.
    if (entry.value !== null) {
      entry.value = null;
      for (const cb of entry.listeners) {
        try { cb(null); } catch { /* ignore */ }
      }
    }
  });

  equippedCache.set(cacheKey, entry);
  return entry;
}

function subscribeEquippedNode(
  uid: string,
  node: string,
  cb: (v: EquippedItem | null) => void,
): () => void {
  const entry = ensureEquippedSubscription(uid, node);
  entry.refCount += 1;
  entry.listeners.add(cb);
  cb(entry.value);
  return () => {
    entry.listeners.delete(cb);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      try { entry.unsub?.(); } catch { /* ignore */ }
      equippedCache.delete(`${uid}/${node}`);
    }
  };
}

function useEquippedNode(uid: string | undefined | null, node: string): EquippedItem | null {
  const [item, setItem] = useState<EquippedItem | null>(() =>
    uid ? equippedCache.get(`${uid}/${node}`)?.value ?? null : null,
  );
  useEffect(() => {
    if (!uid) {
      setItem(null);
      return;
    }
    return subscribeEquippedNode(uid, node, setItem);
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
    }, () => {
      // 2026-10-19 polish: fall back to no background on listener error.
      setDecor((d) => ({ ...d, backgroundUrl: null }));
    });
    const unsubMic = onValue(ref(database, `rooms/${roomId}/activeMicDecor`), (snap) => {
      const v = sanitizeEquipped(snap.val());
      setDecor((d) => ({ ...d, micDecorUrl: v ? v.imageUrl : null }));
    }, () => {
      // 2026-10-19 polish: fall back to no mic decor on listener error.
      setDecor((d) => ({ ...d, micDecorUrl: null }));
    });
    return () => {
      unsubBg();
      unsubMic();
    };
  }, [roomId]);
  return decor;
}
