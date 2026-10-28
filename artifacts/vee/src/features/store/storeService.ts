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
import { authedWalletFetch } from '@/src/features/wallet/walletService';
import * as Crypto from 'expo-crypto';
import { intimacyPairKey } from '@/src/features/voice-room/services/intimacyService';
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

/**
 * SECURITY (2026-10-16 deep audit): never trust the client-provided price.
 * A hacked client could send price=1 for a 10,000💎 item. Always re-fetch
 * the item from the server catalog and use the SERVER price. Returns null
 * if the item doesn't exist or is inactive.
 */
async function getServerCatalogItem(itemId: string): Promise<{
  price: number; validityDays: number; type: string; name: string; imageUrl: string;
} | null> {
  try {
    const snap = await get(ref(database, `store_catalog/${itemId}`));
    if (!snap.exists()) return null;
    const v = snap.val() as any;
    if (v.active === false) return null;
    const price = typeof v.price === 'number' ? v.price : -1;
    if (price < 0) return null;
    return {
      price,
      validityDays: typeof v.validityDays === 'number' ? v.validityDays : 0,
      type: typeof v.type === 'string' ? v.type : '',
      // SECURITY: name/imageUrl also come from the server — a hacked client
      // could otherwise grant itself an arbitrary image.
      name: typeof v.name === 'string' ? v.name : '',
      imageUrl: typeof v.imageUrl === 'string' ? v.imageUrl : '',
    };
  } catch {
    return null;
  }
}

/**
 * Endpoint refund (2026-10-29 store routing): if a grant write fails AFTER
 * a confirmed debit, refund through the wallet service so the user is never
 * charged without receiving the item. Best-effort — never throws. Returns
 * true only when the service confirms refunded:true (already-refunded
 * replays count — the money is back either way). A granted purchase can
 * never be refunded (server returns already_granted).
 */
async function refundStorePurchase(key: string): Promise<boolean> {
  try {
    const res = await authedWalletFetch('/wallet/store/refund', {
      method: 'POST',
      body: { idempotencyKey: key },
      timeoutMs: 6000,
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as { refunded?: boolean };
    return data.refunded === true;
  } catch {
    return false;
  }
}

/**
 * Grant-complete notify (2026-10-29 store routing): fire-and-forget with
 * one retry. Tells the wallet service the grant landed (records grantNode
 * for import dedup). Failure is SAFE — the row stays ungranted and the
 * next purchase attempt resumes it via resume-first. Never throws.
 */
async function notifyGrantComplete(key: string, grantNode: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await authedWalletFetch('/wallet/store/grant-complete', {
        method: 'POST',
        body: { idempotencyKey: key, grantNode, purchasedAt: Date.now() },
        timeoutMs: 6000,
      });
      if (res.ok) return;
    } catch {
      // Retry once, then give up — resume-first covers it.
    }
  }
}

/**
 * Ledger probe (2026-10-29 store routing): after a timeout/abort or a 5xx,
 * the purchase outcome is UNKNOWN — the wallet service may have committed
 * the debit while its response was lost. The probe reads the Postgres
 * ledger directly for this idempotency key (sender-scoped). A landed,
 * unrefunded row proves the debit — the app must NOT re-send with a fresh
 * key. Returns the stored price when confirmed, null after ~4 s.
 * NEVER falls back to a direct Firebase wallet write.
 */
async function confirmStoreLanded(
  key: string,
): Promise<{ price: number } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await authedWalletFetch(
        `/wallet/store/status?idempotencyKey=${encodeURIComponent(key)}`,
        { method: 'GET', timeoutMs: 5000 },
      );
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          landed?: boolean;
          refunded?: boolean;
          price?: number;
        };
        if (data.landed && !data.refunded) {
          return { price: typeof data.price === 'number' ? data.price : 0 };
        }
      }
    } catch {
      // Probe failed — keep polling briefly.
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

type StoreDebitOutcome =
  | { status: 'ok'; key: string; price: number }
  | { status: 'insufficient' }
  | { status: 'unknown_item' }
  | { status: 'not_room_owner' }
  | { status: 'payment_failed' };

/**
 * Store debit via the wallet service (2026-10-29 store routing).
 * ONE HTTPS round trip on the success path. Server-side price from
 * store_catalog; the response price wins for the grant record. Unknown
 * outcomes (timeout / 5xx) are probed, then retried with the SAME key
 * (up to 3 attempts) — never a fresh key, never a Firebase fallback.
 * A resumed row (crash recovery) returns its own key — the caller MUST
 * use the returned key for grant-complete / refund, not the fresh key.
 */
async function purchaseDebit(
  itemId: string,
  context: { roomId?: string; peerUid?: string },
): Promise<StoreDebitOutcome> {
  const key = Crypto.randomUUID();
  const attemptPurchase = async (): Promise<Response | null> => {
    try {
      return await authedWalletFetch('/wallet/store/purchase', {
        method: 'POST',
        body: {
          itemId,
          idempotencyKey: key,
          ...(context.roomId ? { roomId: context.roomId } : {}),
          ...(context.peerUid ? { peerUid: context.peerUid } : {}),
        },
        // Same 6 s cap as gifts — a hung service must never freeze the UI.
        timeoutMs: 6000,
      });
    } catch (e) {
      console.warn('[store] wallet store purchase failed', key, (e as Error)?.message ?? String(e));
      return null;
    }
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await attemptPurchase();
    if (res) {
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          price?: number;
          code?: string;
          key?: string;
        };
        if (data.ok) {
          return {
            status: 'ok',
            key: typeof data.key === 'string' && data.key ? data.key : key,
            price: typeof data.price === 'number' ? data.price : 0,
          };
        }
        if (data.code === 'insufficient') return { status: 'insufficient' };
        if (data.code === 'unknown_item') return { status: 'unknown_item' };
        if (data.code === 'not_room_owner') return { status: 'not_room_owner' };
        if (typeof data.code === 'string' && data.code.length > 0) {
          return { status: 'payment_failed' }; // known rejection — final
        }
        // 200 with an unrecognized body: outcome unknown → probe below.
      } else if (res.status < 500) {
        // 400 malformed, 401/403 auth, 404, 429 rate limit: final — the
        // service wrote nothing (a re-tap retries).
        return { status: 'payment_failed' };
      }
      // 5xx → unknown outcome → probe below.
    }
    const landed = await confirmStoreLanded(key).catch(() => null);
    if (landed) return { status: 'ok', key, price: landed.price };
  }
  return { status: 'payment_failed' };
}

/**
 * Grant with confirm (2026-10-29 store routing): run the grant write
 * (retry once), then confirm by re-reading the node(s). A set that landed
 * but reported a throw still counts via the confirm read — the
 * ambiguous-write edge is closed: present grant = success, never a
 * refund. Returns true when the grant is confirmed present.
 */
async function grantWithConfirm(
  grant: () => Promise<void>,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await grant();
    } catch {
      // Fall through to the confirm read — the set may have landed.
    }
    try {
      if (await confirm()) return true;
    } catch {
      // Confirm read failed — retry the grant once more.
    }
  }
  return false;
}

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
 * 1. Debit via the wallet service endpoint (InsufficientFundsError when short).
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
    // SECURITY: use the SERVER price, never the client-provided one.
    const serverItem = await getServerCatalogItem(item.id);
    if (!serverItem) return { success: false, error: 'Item not available' };
    if (!serverItem.type || serverItem.type !== item.type) {
      return { success: false, error: 'Item not available' };
    }
    // Idempotent: already owned and not expired → success.
    const ownedSnap = await get(ref(database, `users/${uid}/${node}/${item.id}`));
    if (ownedSnap.exists()) {
      const owned = ownedSnap.val() as any;
      if (!isExpired(owned)) return { success: true };
    }
    const debit = await purchaseDebit(item.id, {});
    if (debit.status === 'insufficient') {
      return { success: false, error: 'Not enough diamonds' };
    }
    if (debit.status === 'unknown_item') {
      return { success: false, error: 'Item not available' };
    }
    if (debit.status !== 'ok') {
      return { success: false, error: 'Payment failed. Try again.' };
    }
    // Endpoint price wins for the grant record (catalog may have moved
    // between the app's read and the debit).
    const price = debit.price;
    const grantNode = `users/${uid}/${node}/${item.id}`;
    const granted = await grantWithConfirm(
      () => set(ref(database, grantNode), buildGrantRecord({
        ...item,
        price,
        validityDays: serverItem.validityDays,
        name: serverItem.name || item.name,
        imageUrl: serverItem.imageUrl || item.imageUrl,
      })),
      async () => {
        try {
          const snap = await get(ref(database, grantNode));
          return snap.exists();
        } catch {
          return false;
        }
      },
    );
    if (!granted) {
      const refunded = await refundStorePurchase(debit.key);
      return refunded
        ? { success: false, error: 'Purchase failed. Your diamonds were refunded.' }
        : { success: false, error: 'Payment failed. Try again.' };
    }
    void notifyGrantComplete(debit.key, grantNode);
    return { success: true };
  } catch {
    return { success: false, error: 'Purchase failed. Try again.' };
  }
}

/**
 * Buy a Mic Handshake design FOR A PAIR (2026-10-20, Sumon).
 * Same money safety as purchaseStoreItem: server price, atomic debit,
 * refund if the grant write fails. The grant lives at
 * `micHandshakes/{pairKey}` — a pair-scoped record, not personal
 * inventory — and the voice room reads it live. Re-buying replaces the
 * design and restarts the validity window.
 */
export async function purchaseHandshakeForPair(
  uid: string,
  item: StoreCatalogItem,
  peerUid: string,
): Promise<PurchaseResult> {
  if (!peerUid || peerUid === uid) return { success: false, error: 'Choose a friend first' };
  try {
    const serverItem = await getServerCatalogItem(item.id);
    if (!serverItem || serverItem.type !== 'micHandshake') {
      return { success: false, error: 'Item not available' };
    }
    const debit = await purchaseDebit(item.id, { peerUid });
    if (debit.status === 'insufficient') {
      return { success: false, error: 'Not enough diamonds' };
    }
    if (debit.status === 'unknown_item') {
      return { success: false, error: 'Item not available' };
    }
    if (debit.status !== 'ok') {
      return { success: false, error: 'Payment failed. Try again.' };
    }
    const now = Date.now();
    const pairKey = intimacyPairKey(uid, peerUid);
    const grantNode = `micHandshakes/${pairKey}`;
    const granted = await grantWithConfirm(
      () => set(ref(database, grantNode), {
        designKey: item.id,
        itemId: item.id,
        buyerUid: uid,
        purchasedAt: now,
        expiresAt: serverItem.validityDays > 0
          ? now + serverItem.validityDays * 86400000
          : 4102444800000, // 2100-01-01 — permanent
      }),
      async () => {
        try {
          const snap = await get(ref(database, grantNode));
          const v = snap.val() as any;
          return !!v && v.buyerUid === uid && (v.designKey === item.id || v.itemId === item.id);
        } catch {
          return false;
        }
      },
    );
    if (!granted) {
      const refunded = await refundStorePurchase(debit.key);
      return refunded
        ? { success: false, error: 'Purchase failed. Your diamonds were refunded.' }
        : { success: false, error: 'Payment failed. Try again.' };
    }
    void notifyGrantComplete(debit.key, grantNode);
    return { success: true };
  } catch {
    return { success: false, error: 'Purchase failed. Try again.' };
  }
}

/** Current pair handshake (for the store sheet's status line). */
export async function fetchPairHandshakeOnce(
  uid: string,
  peerUid: string,
): Promise<{ designKey: string; expiresAt: number } | null> {
  try {
    const snap = await get(ref(database, `micHandshakes/${intimacyPairKey(uid, peerUid)}`));
    if (!snap.exists()) return null;
    const v = snap.val() as any;
    if (!v || typeof v.expiresAt !== 'number' || v.expiresAt <= Date.now()) return null;
    return { designKey: String(v.designKey || ''), expiresAt: v.expiresAt };
  } catch {
    return null;
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
  // SECURITY: use the SERVER price, never the client-provided one.
  const serverItem = await getServerCatalogItem(item.id);
  if (!serverItem) return { success: false, error: 'Item not available' };
  // Unknown type is a client routing error — it must NEVER debit first
  // (the old code debited, then returned here with no grant and no refund).
  if (item.type !== 'roomBackground' && item.type !== 'micDecor') {
    return { success: false, error: 'Unknown room item type' };
  }
  const validityDays = serverItem.validityDays;
  const srvName = serverItem.name || item.name;
  const srvImageUrl = serverItem.imageUrl || item.imageUrl;
  try {
    const debit = await purchaseDebit(item.id, { roomId });
    if (debit.status === 'insufficient') {
      return { success: false, error: 'Not enough diamonds' };
    }
    if (debit.status === 'unknown_item') {
      return { success: false, error: 'Item not available' };
    }
    if (debit.status === 'not_room_owner') {
      return { success: false, error: 'You can only buy this for your own room' };
    }
    if (debit.status !== 'ok') {
      return { success: false, error: 'Payment failed. Try again.' };
    }
    const expiresAt = validityDays > 0 ? Date.now() + validityDays * 86400_000 : undefined;
    const validity: 'permanent' | number = validityDays > 0 ? validityDays : 'permanent';
    const isBg = item.type === 'roomBackground';
    const grantNode = isBg
      ? `rooms/${roomId}/storeBackground`
      : `rooms/${roomId}/micDecors/${item.id}`;
    const granted = await grantWithConfirm(
      async () => {
        if (isBg) {
          await set(ref(database, `rooms/${roomId}/storeBackground`), {
            itemId: item.id,
            name: srvName,
            imageUrl: srvImageUrl,
            purchasedAt: Date.now(),
            validity,
            ...(expiresAt ? { expiresAt } : {}),
          });
        } else {
          const record = {
            id: item.id,
            name: srvName,
            icon: srvImageUrl,
            obtainedAt: Date.now(),
            validity,
            source: 'store',
            ...(expiresAt ? { expiresAt } : {}),
          };
          await set(ref(database, `rooms/${roomId}/micDecors/${item.id}`), record);
          await set(ref(database, `rooms/${roomId}/activeMicDecor`), {
            itemId: item.id,
            imageUrl: srvImageUrl,
            name: srvName,
            ...(expiresAt ? { expiresAt } : {}),
          });
        }
      },
      async () => {
        try {
          if (isBg) {
            const snap = await get(ref(database, `rooms/${roomId}/storeBackground`));
            const v = snap.val() as any;
            return !!v && v.itemId === item.id;
          }
          const [dSnap, aSnap] = await Promise.all([
            get(ref(database, `rooms/${roomId}/micDecors/${item.id}`)),
            get(ref(database, `rooms/${roomId}/activeMicDecor`)),
          ]);
          const a = aSnap.val() as any;
          return dSnap.exists() && !!a && a.itemId === item.id;
        } catch {
          return false;
        }
      },
    );
    if (!granted) {
      const refunded = await refundStorePurchase(debit.key);
      return refunded
        ? { success: false, error: 'Purchase failed. Your diamonds were refunded.' }
        : { success: false, error: 'Payment failed. Try again.' };
    }
    void notifyGrantComplete(debit.key, grantNode);
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
