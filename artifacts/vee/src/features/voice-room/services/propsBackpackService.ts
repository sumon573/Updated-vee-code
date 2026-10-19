/**
 * propsBackpackService.ts — IMO props backpack, ported to Vee (2026-10-19).
 *
 * IMO evidence: voiceroom/backpack/proppackage/ — personal props inventory
 * (OwnPackageToolsHeaderData, PackageToolRankInfo, CommonPropsBuyInfo):
 * the user sees everything they own, uses props in-room, buys more from store.
 *
 * Vee backend: the existing store inventory nodes —
 *   users/{uid}/{micStickers|frames|entryEffects|profileSkins|ripples}/{itemId}
 * Equip/unequip reuses storeService (ownership re-verified server-side).
 * No new Firebase rules needed (existing inventory rules cover reads;
 * equip writes go through the existing active-node rules).
 */

import { ref, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { isExpired } from '@/src/features/store/storeService';

export type BackpackTab = 'micSticker' | 'avatarFrame' | 'entryEffect' | 'profileSkin' | 'soundRipple';

export const BACKPACK_TABS: BackpackTab[] = [
  'micSticker', 'avatarFrame', 'entryEffect', 'profileSkin', 'soundRipple',
];

const INVENTORY_NODE: Record<BackpackTab, string> = {
  micSticker: 'micStickers',
  avatarFrame: 'frames',
  entryEffect: 'entryEffects',
  profileSkin: 'profileSkins',
  soundRipple: 'ripples',
};

export interface BackpackItem {
  itemId: string;
  name: string;
  imageUrl: string;
  expiresAt?: number;
}

export interface BackpackState {
  items: Record<BackpackTab, BackpackItem[]>;
  /** active (equipped) item id per tab, for the "Using" badge */
  active: Record<BackpackTab, string | null>;
}

const EMPTY: BackpackState = {
  items: { micSticker: [], avatarFrame: [], entryEffect: [], profileSkin: [], soundRipple: [] },
  active: { micSticker: null, avatarFrame: null, entryEffect: null, profileSkin: null, soundRipple: null },
};

function sanitizeItem(raw: unknown): BackpackItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id) return null;
  if (typeof v.imageUrl !== 'string' || !v.imageUrl) return null;
  if (typeof v.expiresAt === 'number' && v.expiresAt <= Date.now()) return null;
  return {
    itemId: v.id,
    name: typeof v.name === 'string' ? v.name : '',
    imageUrl: v.imageUrl,
    ...(typeof v.expiresAt === 'number' ? { expiresAt: v.expiresAt } : {}),
  };
}

/**
 * Live backpack: all owned props + which one is active per tab.
 * Listens to the 5 inventory nodes + 5 active nodes for uid.
 */
export function subscribeBackpack(uid: string, cb: (s: BackpackState) => void): () => void {
  const state: BackpackState = {
    items: { micSticker: [], avatarFrame: [], entryEffect: [], profileSkin: [], soundRipple: [] },
    active: { micSticker: null, avatarFrame: null, entryEffect: null, profileSkin: null, soundRipple: null },
  };
  const emit = () => cb({
    items: { ...state.items },
    active: { ...state.active },
  });
  const unsubs: Array<() => void> = [];

  for (const tab of BACKPACK_TABS) {
    unsubs.push(onValue(
      ref(database, `users/${uid}/${INVENTORY_NODE[tab]}`),
      (snap) => {
        const list: BackpackItem[] = [];
        if (snap.exists()) {
          snap.forEach((c) => {
            const it = sanitizeItem(c.val());
            if (it && !isExpired(it)) list.push(it);
          });
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        state.items[tab] = list;
        emit();
      },
      () => { state.items[tab] = []; emit(); },
    ));
  }

  // Active nodes: object form {itemId} or plain string id (per storeService).
  const ACTIVE_NODE: Record<BackpackTab, string> = {
    micSticker: 'activeMicSticker',
    avatarFrame: 'activeFrame',
    entryEffect: 'activeEntryEffect',
    profileSkin: 'activeProfileSkin',
    soundRipple: 'activeRipple',
  };
  for (const tab of BACKPACK_TABS) {
    unsubs.push(onValue(
      ref(database, `users/${uid}/${ACTIVE_NODE[tab]}`),
      (snap) => {
        const v = snap.val() as unknown;
        let id: string | null = null;
        if (typeof v === 'string') id = v;
        else if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).itemId === 'string') {
          id = (v as Record<string, string>).itemId;
        }
        state.active[tab] = id;
        emit();
      },
      () => { state.active[tab] = null; emit(); },
    ));
  }

  emit();
  return () => unsubs.forEach((u) => u());
}
