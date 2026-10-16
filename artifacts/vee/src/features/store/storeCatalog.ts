/**
 * storeCatalog.ts — IMO-style Store catalog (2026-10-16, Sumon).
 *
 * The Store is fully SERVER-DRIVEN: item designs live in Firebase RTDB
 * `store_catalog/{itemId}` (admin-managed, like honors_catalog). Adding a new
 * design = one RTDB write — no APK update, no code change.
 *
 * Tabs: Personal | Room (IMO-হুবহু)
 * - Personal categories: Mic Sticker, Avatar Frame, Entry Effect,
 *   Profile Skin, Sound Ripple
 * - Room categories: Top Short IDs, Background, Mic Decor
 *
 * Short IDs are NOT in the server catalog — they use the existing
 * SHORT_ID_CATALOG (Sumon's approved 4-digit pricing) + the atomic
 * server purchase endpoint.
 */

import { ref, get } from 'firebase/database';
import { database } from '@/src/config/firebase';

export type StoreTab = 'personal' | 'room';

export type StoreItemType =
  | 'micSticker'
  | 'avatarFrame'
  | 'entryEffect'
  | 'profileSkin'
  | 'soundRipple'
  | 'shortId'
  | 'roomBackground'
  | 'micDecor';

export interface StoreCatalogItem {
  /** Unique id, e.g. "sticker-rose-01" */
  id: string;
  type: StoreItemType;
  tab: StoreTab;
  /** Category header the item appears under */
  category: string;
  name: string;
  /** CDN URL of the design image */
  imageUrl: string;
  /** Price in diamonds */
  price: number;
  /** Validity in days after purchase. 0 = permanent. */
  validityDays: number;
  /** IMO star badge (4 or 5). Omitted = no badge. */
  star?: number;
  sortOrder?: number;
  active: boolean;
}

export const PERSONAL_CATEGORIES = [
  'Mic Sticker',
  'Avatar Frame',
  'Entry Effect',
  'Profile Skin',
  'Sound Ripple',
] as const;

export const ROOM_CATEGORIES = [
  'Top Short IDs',
  'Background',
  'Mic Decor',
] as const;

/** Which catalog types are bought for a ROOM (need a room picker). */
export function isRoomItem(type: StoreItemType): boolean {
  return type === 'shortId' || type === 'roomBackground' || type === 'micDecor';
}

function sanitizeItem(id: string, raw: any): StoreCatalogItem | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.active === false) return null;
  const type = raw.type as StoreItemType;
  const tab = raw.tab as StoreTab;
  if (!type || (tab !== 'personal' && tab !== 'room')) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (typeof raw.imageUrl !== 'string' || !raw.imageUrl.trim()) return null;
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) return null;
  return {
    id,
    type,
    tab,
    category: typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : defaultCategoryFor(type, tab),
    name: raw.name.trim(),
    imageUrl: raw.imageUrl.trim(),
    price: Math.floor(price),
    validityDays: Number.isFinite(Number(raw.validityDays)) && Number(raw.validityDays) > 0
      ? Math.floor(Number(raw.validityDays))
      : 0,
    star: raw.star === 4 || raw.star === 5 ? raw.star : undefined,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    active: true,
  };
}

function defaultCategoryFor(type: StoreItemType, tab: StoreTab): string {
  if (tab === 'room') {
    if (type === 'shortId') return 'Top Short IDs';
    if (type === 'roomBackground') return 'Background';
    return 'Mic Decor';
  }
  switch (type) {
    case 'micSticker': return 'Mic Sticker';
    case 'avatarFrame': return 'Avatar Frame';
    case 'entryEffect': return 'Entry Effect';
    case 'profileSkin': return 'Profile Skin';
    case 'soundRipple': return 'Sound Ripple';
    default: return 'Mic Sticker';
  }
}

/**
 * Fetch the live store catalog from RTDB. Sorted by (sortOrder, name).
 * Returns [] when the shelves are empty (Sumon: designs come later).
 */
export async function fetchStoreCatalog(): Promise<StoreCatalogItem[]> {
  try {
    const snap = await get(ref(database, 'store_catalog'));
    if (!snap.exists()) return [];
    const raw = snap.val() as Record<string, any>;
    const items: StoreCatalogItem[] = [];
    for (const [id, val] of Object.entries(raw)) {
      const item = sanitizeItem(id, val);
      if (item) items.push(item);
    }
    items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    return items;
  } catch {
    return [];
  }
}

/** Human-readable validity label for the preview sheet (IMO: "Validity for 7 days"). */
export function validityLabel(validityDays: number): string {
  return validityDays > 0 ? `Validity for ${validityDays} day${validityDays === 1 ? '' : 's'}` : 'Permanent';
}
