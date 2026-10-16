/**
 * storeService.ts — IMO Store purchase + inventory + equip (2026-10-16, Sumon).
 *
 * THE WHOLE PATH (Sumon's order: "পুরো রাস্তা যেন ক্লিয়ার থাকে"):
 *   Store card → preview → buy (diamonds) → inventory → equip → shows live.
 *
 * Where each type lives and where it displays:
 * ┌──────────────┬────────────────────────────────┬──────────────────────┬───────────────────────────────┐
 * │ type         │ inventory node                 │ active node          │ displays on                   │
 * ├──────────────┼────────────────────────────────┼──────────────────────┼───────────────────────────────┤
 * │ micSticker   │ users/{uid}/micStickers/{id}   │ activeMicSticker*    │ voice-room seat mic badge     │
 * │ avatarFrame  │ users/{uid}/frames/{id}        │ activeFrame (id)     │ profile DP, voice seats       │
 * │ entryEffect  │ users/{uid}/entryEffects/{id}  │ activeEntryEffect(id)│ room entry banner             │
 * │ profileSkin  │ users/{uid}/profileSkins/{id}  │ activeProfileSkin*   │ profile screen background     │
 * │ soundRipple  │ users/{uid}/ripples/{id}       │ activeRipple (id)    │ speaking ripple               │
 * │ shortId      │ shortIds/{users|rooms}/{id}    │ users/{uid}/shortId  │ profile gold badge, search    │
 * │ roomBackgnd  │ rooms/{rid}/storeBackground    │ (the node itself)    │ voice room background         │
 * │ micDecor     │ rooms/{rid}/micDecors/{id}     │ activeMicDecor*      │ room seat mic dots            │
 * └──────────────┴────────────────────────────────┴──────────────────────┴───────────────────────────────┘
 *  * = object {itemId, imageUrl, name, expiresAt?} (new nodes).
 *  Existing systems (frames/ripples/entryEffects) keep their EXACT shapes:
 *  GrantedFrame/GrantedRipple/GrantedEntryEffect + string-id active nodes.
 *
 * Validity: catalog validityDays → validity ('permanent'|days) + expiresAt
 * on grant. Expired items cannot be equipped.
 */

import { ref, get, set, remove } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { debitOwnWallet, InsufficientFundsError } from '@/src/features/wallet/walletService';
import type { StoreCatalogItem, StoreItemType } from './storeCatalog';

export interface OwnedStoreItem {
  itemId: string;
  name: string;
  imageUrl: string;
  type: StoreItemType;
  price: number;
  purchasedAt: number;
  /** ms epoch. Absent = permanent. */
  expiresAt?: number;
}

export interface EquippedItem {
  itemId: string;
  imageUrl: string;
  name: string;
  expiresAt?: number;
}

/** Inventory collection node per personal item type. */
const INVENTORY_NODE: Record<string, string> = {
  micSticker: 'micStickers',
  avatarFrame: 'frames',
  entryEffect: 'entryEffects',
  profileSkin: 'profileSkins',
  soundRipple: 'ripples',
};

/** Active-equip node per personal item type. */
const ACTIVE_NODE: Record<string, string> = {
  micSticker: 'activeMicSticker',
  avatarFrame: 'activeFrame',
  entryEffect: 'activeEntryEffect',
  profileSkin: 'activeProfileSkin',
  soundRipple: 'activeRipple',
};

/** Types whose active node stores a plain string id (existing systems). */
const STRING_ACTIVE_TYPES = new Set(['avatarFrame', 'entryEffect', 'soundRipple']);

export function isExpired(item: { expiresAt?: number } | null | undefined): boolean {
  if (!item || !item.expiresAt) return false;
  return item.expiresAt <= Date.now();
}

/** Build the inventory record in the EXISTING shape for each type. */
function buildGrantRecord(item: StoreCatalogItem): Record<string, any> {
  const expiresAt = item.validityDays > 0 ? Date.now() + item.validityDays * 86400_000 : undefined;
  const validity: 'permanent' | number = item.validityDays > 0 ? item.validityDays : 'permanent';
  const base = {
    id: item.id,
    name: item.name,
    obtainedAt: Date.now(),
    validity,
    source: 'store',
    ...(expiresAt ? { expiresAt } : {}),
  };
  switch (item.type) {
    case 'avatarFrame':
    case 'soundRipple':
    case 'entryEffect':
      // Existing collectible shape: {id, name, icon, obtainedAt, validity, source}
      return { ...base, icon: item.imageUrl, price: item.price };
    default:
      // New store-only types
      return {
        ...base,
        itemId: item.id,
        imageUrl: item.imageUrl,
        type: item.type,
        price: item.price,
        purchasedAt: Date.now(),
      };
  }
}

/** All owned items of one type for a user. */
export async function getOwnedItems(
  uid: string,
  type: StoreItemType,
): Promise<Record<string, OwnedStoreItem>> {
  const node = INVENTORY_NODE[type];
  if (!node) return {};
  try {
    const snap = await get(ref(database, `users/${uid}/${node}`));
    if (!snap.exists()) return {};
    const raw = snap.val() as Record<string, any>;
    const out: Record<string, OwnedStoreItem> = {};
    for (const [key, val] of Object.entries(raw)) {
      if (!val || typeof val !== 'object') continue;
      const id = typeof val.id === 'string' ? val.id : (typeof val.itemId === 'string' ? val.itemId : key);
      out[key] = {
        itemId: id,
        name: typeof val.name === 'string' ? val.name : '',
        imageUrl: typeof val.icon === 'string' ? val.icon : (typeof val.imageUrl === 'string' ? val.imageUrl : ''),
        type,
        price: typeof val.price === 'number' ? val.price : 0,
        purchasedAt: typeof val.purchasedAt === 'number' ? val.purchasedAt : (typeof val.obtainedAt === 'number' ? val.obtainedAt : 0),
        ...(typeof val.expiresAt === 'number' ? { expiresAt: val.expiresAt } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Currently equipped item of one type (null when none or expired).
 * Handles both string-id active nodes (frames/ripples/entryEffects) and
 * object active nodes (micSticker/profileSkin).
 */
export async function getEquippedItem(
  uid: string,
  type: StoreItemType,
): Promise<EquippedItem | null> {
  const node = ACTIVE_NODE[type];
  if (!node) return null;
  try {
    const snap = await get(ref(database, `users/${uid}/${node}`));
    if (!snap.exists()) return null;
    const val = snap.val();
    if (typeof val === 'string') {
      // Existing string-id form — look up the image from inventory.
      const owned = await getOwnedItems(uid, type);
      const match = Object.values(owned).find((o) => o.itemId === val);
      if (!match || isExpired(match)) return null;
      return { itemId: match.itemId, imageUrl: match.imageUrl, name: match.name, ...(match.expiresAt ? { expiresAt: match.expiresAt } : {}) };
    }
    if (val && typeof val === 'object') {
      const item = val as EquippedItem;
      if (!item.itemId || isExpired(item)) return null;
      return item;
    }
    return null;
  } catch {
    return null;
  }
}

export type PurchaseResult = { success: boolean; error?: string };

/**
 * Buy a PERSONAL store item with diamonds.
 * 1. Debit wallet atomically (InsufficientFundsError when short).
 * 2. Grant into the type's inventory node (existing shape per type).
 * Does NOT auto-equip — the preview sheet offers Use after purchase.
 */
export async function purchaseStoreItem(
  uid: string,
  item: StoreCatalogItem,
): Promise<PurchaseResult> {
  const node = INVENTORY_NODE[item.type];
  if (!node) return { success: false, error: 'Unknown item type' };
  try {
    // Idempotent: already owned and not expired → success.
    const ownedSnap = await get(ref(database, `users/${uid}/${node}/${item.id}`));
    if (ownedSnap.exists()) {
      const owned = ownedSnap.val() as any;
      if (!isExpired(owned)) return { success: true };
    }
    try {
      await debitOwnWallet(uid, item.price);
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return { success: false, error: 'Not enough diamonds' };
      }
      return { success: false, error: 'Payment failed. Try again.' };
    }
    await set(ref(database, `users/${uid}/${node}/${item.id}`), buildGrantRecord(item));
    return { success: true };
  } catch {
    return { success: false, error: 'Purchase failed. Try again.' };
  }
}

/**
 * Equip an owned personal item. Validates ownership + expiry.
 * - frames/ripples/entryEffects: writes the STRING id (existing form —
 *   keeps the 2026-10-13 activeFrame ownership rule working).
 * - micSticker/profileSkin: writes the object form.
 */
export async function equipStoreItem(
  uid: string,
  type: StoreItemType,
  item: OwnedStoreItem,
): Promise<PurchaseResult> {
  const activeNode = ACTIVE_NODE[type];
  if (!activeNode) return { success: false, error: 'Unknown item type' };
  if (isExpired(item)) return { success: false, error: 'This item has expired' };
  // Re-verify ownership from the server (never trust the caller's object).
  try {
    const ownedSnap = await get(ref(database, `users/${uid}/${INVENTORY_NODE[type]}/${item.itemId}`));
    if (!ownedSnap.exists() || isExpired(ownedSnap.val())) {
      return { success: false, error: 'You do not own this item' };
    }
  } catch {
    return { success: false, error: 'Could not verify ownership' };
  }
  try {
    if (STRING_ACTIVE_TYPES.has(type)) {
      await set(ref(database, `users/${uid}/${activeNode}`), item.itemId);
    } else {
      const equipped: EquippedItem = {
        itemId: item.itemId,
        imageUrl: item.imageUrl,
        name: item.name,
        ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      };
      await set(ref(database, `users/${uid}/${activeNode}`), equipped);
    }
    return { success: true };
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/permission/i.test(msg)) {
      return { success: false, error: 'You do not own this item' };
    }
    return { success: false, error: 'Could not equip. Try again.' };
  }
}

/** Unequip (remove the active node). */
export async function unequipStoreItem(
  uid: string,
  type: StoreItemType,
): Promise<void> {
  const activeNode = ACTIVE_NODE[type];
  if (!activeNode) return;
  try {
    await remove(ref(database, `users/${uid}/${activeNode}`));
  } catch {
    // non-critical
  }
}

// ── Room items ──────────────────────────────────────────────────────────

export interface OwnedRoom {
  id: string;
  name: string;
}

/** Rooms owned by the user (for room-item purchases). */
export async function getMyOwnedRooms(uid: string): Promise<OwnedRoom[]> {
  try {
    const { query, orderByChild, equalTo } = await import('firebase/database');
    const q = query(
      ref(database, 'rooms'),
      orderByChild('info/ownerId'),
      equalTo(uid),
    );
    const snap = await get(q);
    if (!snap.exists()) return [];
    const out: OwnedRoom[] = [];
    snap.forEach((child) => {
      const info = (child.val() as any)?.info;
      const active = info?.active;
      if (active === false) return false; // skip disbanded
      out.push({
        id: child.key as string,
        name: typeof info?.name === 'string' && info.name.trim()
          ? info.name.trim()
          : `Room ${child.key}`,
      });
      return false;
    });
    return out;
  } catch {
    return [];
  }
}

async function assertOwnsRoom(uid: string, roomId: string): Promise<boolean> {
  try {
    const snap = await get(ref(database, `rooms/${roomId}/info/ownerId`));
    if (snap.val() === uid) return true;
    const snap2 = await get(ref(database, `rooms/${roomId}/info/ownerUid`));
    return snap2.val() === uid;
  } catch {
    return false;
  }
}

/**
 * Buy a ROOM store item (roomBackground / micDecor) with diamonds.
 * Verifies the buyer owns the room, debits, then writes the room node.
 * - roomBackground: single node rooms/{rid}/storeBackground (set = equip).
 * - micDecor: granted to rooms/{rid}/micDecors/{id} and auto-equipped as
 *   rooms/{rid}/activeMicDecor (one decor at a time per room).
 */
export async function purchaseRoomStoreItem(
  uid: string,
  item: StoreCatalogItem,
  roomId: string,
): Promise<PurchaseResult> {
  if (!roomId) return { success: false, error: 'Select a room first' };
  if (!(await assertOwnsRoom(uid, roomId))) {
    return { success: false, error: 'You can only buy this for your own room' };
  }
  // 2026-10-16 verification fix: IDEMPOTENT — already using this exact item
  // (and not expired) → success without charging again. Prevents double-charge
  // on re-tap.
  try {
    const activeNode = item.type === 'roomBackground' ? 'storeBackground' : 'activeMicDecor';
    const curSnap = await get(ref(database, `rooms/${roomId}/${activeNode}`));
    const cur = curSnap.val();
    if (cur && cur.itemId === item.id && !isExpired(cur)) {
      return { success: true };
    }
  } catch {
    // non-critical — fall through to purchase
  }
  try {
    try {
      await debitOwnWallet(uid, item.price);
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        return { success: false, error: 'Not enough diamonds' };
      }
      return { success: false, error: 'Payment failed. Try again.' };
    }
    const expiresAt = item.validityDays > 0 ? Date.now() + item.validityDays * 86400_000 : undefined;
    const validity: 'permanent' | number = item.validityDays > 0 ? item.validityDays : 'permanent';
    if (item.type === 'roomBackground') {
      await set(ref(database, `rooms/${roomId}/storeBackground`), {
        itemId: item.id,
        name: item.name,
        imageUrl: item.imageUrl,
        purchasedAt: Date.now(),
        validity,
        ...(expiresAt ? { expiresAt } : {}),
      });
    } else if (item.type === 'micDecor') {
      const record = {
        id: item.id,
        name: item.name,
        icon: item.imageUrl,
        obtainedAt: Date.now(),
        validity,
        source: 'store',
        ...(expiresAt ? { expiresAt } : {}),
      };
      await set(ref(database, `rooms/${roomId}/micDecors/${item.id}`), record);
      await set(ref(database, `rooms/${roomId}/activeMicDecor`), {
        itemId: item.id,
        imageUrl: item.imageUrl,
        name: item.name,
        ...(expiresAt ? { expiresAt } : {}),
      });
    } else {
      return { success: false, error: 'Unknown room item type' };
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Purchase failed. Try again.' };
  }
}

/**
 * Current store decor state of a room (for Using-state display).
 * Returns the active background / mic decor itemIds (null when none/expired).
 */
export async function getRoomStoreDecorState(
  roomId: string,
): Promise<{ backgroundItemId: string | null; micDecorItemId: string | null }> {
  const out = { backgroundItemId: null as string | null, micDecorItemId: null as string | null };
  try {
    const [bgSnap, micSnap] = await Promise.all([
      get(ref(database, `rooms/${roomId}/storeBackground`)),
      get(ref(database, `rooms/${roomId}/activeMicDecor`)),
    ]);
    const bg = bgSnap.val();
    if (bg && typeof bg.itemId === 'string' && !isExpired(bg)) out.backgroundItemId = bg.itemId;
    const mic = micSnap.val();
    if (mic && typeof mic.itemId === 'string' && !isExpired(mic)) out.micDecorItemId = mic.itemId;
  } catch {
    // non-critical
  }
  return out;
}

/** Remove a room's background (owner only). */
export async function removeRoomBackground(uid: string, roomId: string): Promise<void> {
  if (!(await assertOwnsRoom(uid, roomId))) return;
  try {
    await remove(ref(database, `rooms/${roomId}/storeBackground`));
  } catch {
    // non-critical
  }
}

/** Remove a room's mic decor (owner only). */
export async function removeRoomMicDecor(uid: string, roomId: string): Promise<void> {
  if (!(await assertOwnsRoom(uid, roomId))) return;
  try {
    await remove(ref(database, `rooms/${roomId}/activeMicDecor`));
  } catch {
    // non-critical
  }
}
