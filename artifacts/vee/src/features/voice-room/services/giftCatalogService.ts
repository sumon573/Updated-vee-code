/**
 * 2026-10-16 (Sumon): Server-driven gift catalog.
 * Gifts come from RTDB `gift_catalog/{giftId}` — no app build needed to add/update gifts.
 * Structure per gift:
 *   id, name, price, category (classic|premium|luxury), thumbnailUrl,
 *   animationUrl (optional video), animationType (video|image|none),
 *   sortOrder, active
 */

import { ref, onValue, off, get } from 'firebase/database';
import { database } from '@/src/config/firebase';

export type GiftCategory = string;
// Known categories (server can add more without code change)
// 'classic' | 'premium' | 'luxury'

export interface CatalogGift {
  id: string;
  name: string;
  price: number;
  category: GiftCategory;
  thumbnailUrl: string;
  animationUrl?: string;
  animationType?: string; // 'video' | 'image' | 'none' (server can add more)
  sortOrder: number;
  active: boolean;
  metadata?: Record<string, unknown>;
}

const CATALOG_PATH = 'gift_catalog';

// In-memory cache
let cachedGifts: CatalogGift[] | null = null;
let listeners: Array<(gifts: CatalogGift[]) => void> = [];

function normalizeGift(id: string, data: any): CatalogGift | null {
  if (!data || typeof data !== 'object') return null;
  // Skip inactive gifts
  if (data.active === false) return null;

  // 2026-10-17 (Sumon): Accept price/coins/diamonds — Firebase field name varies.
  // Robust: check all possible price fields so gifts never silently disappear.
  const rawPrice = data.price ?? data.coins ?? data.diamonds ?? 0;

  const rawCategory = String(data.category || 'classic').trim();
  const safeCategory = rawCategory || 'classic';

  const knownKeys = new Set(['name', 'price', 'category', 'thumbnailUrl', 'animationUrl',
    'animationType', 'sortOrder', 'active']);
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!knownKeys.has(k)) metadata[k] = v;
  }

  return {
    id,
    name: String(data.name || id),
    price: Number(rawPrice) || 0,
    category: safeCategory,
    thumbnailUrl: String(data.thumbnailUrl || ''),
    animationUrl: data.animationUrl ? String(data.animationUrl) : undefined,
    animationType: data.animationType ? String(data.animationType) : 'none',
    sortOrder: Number(data.sortOrder) || 0,
    active: true,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function sortGifts(gifts: CatalogGift[]): CatalogGift[] {
  return [...gifts].sort((a, b) => {
    // First by category (known categories first, then alphabetical), then sortOrder, then price
    const knownOrder: Record<string, number> = { classic: 0, premium: 1, luxury: 2 };
    const aOrder = knownOrder[a.category] ?? 100;
    const bOrder = knownOrder[b.category] ?? 100;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder === 100 && bOrder === 100 && a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.price - b.price;
  });
}

/**
 * Fetch gift catalog once from server.
 */
export async function fetchGiftCatalog(): Promise<CatalogGift[]> {
  try {
    const snap = await get(ref(database, CATALOG_PATH));
    if (!snap.exists()) {
      cachedGifts = [];
      return [];
    }
    const data = snap.val();
    const gifts: CatalogGift[] = [];
    for (const [id, giftData] of Object.entries(data)) {
      const gift = normalizeGift(id, giftData);
      if (gift) gifts.push(gift);
    }
    cachedGifts = sortGifts(gifts);
    return cachedGifts;
  } catch (e) {
    console.warn('[giftCatalog] fetch failed:', e);
    return cachedGifts || [];
  }
}

/**
 * Subscribe to gift catalog changes (real-time).
 * Returns unsubscribe function.
 */
export function subscribeGiftCatalog(callback: (gifts: CatalogGift[]) => void): () => void {
  listeners.push(callback);

  // Send cached immediately if available
  if (cachedGifts) {
    callback(cachedGifts);
  }

  const catalogRef = ref(database, CATALOG_PATH);
  const handler = (snap: any) => {
    const gifts: CatalogGift[] = [];
    if (snap.exists()) {
      const data = snap.val();
      for (const [id, giftData] of Object.entries(data)) {
        const gift = normalizeGift(id, giftData);
        if (gift) gifts.push(gift);
      }
    }
    cachedGifts = sortGifts(gifts);
    listeners.forEach(l => {
      try { l(cachedGifts!); } catch (e) { console.warn('[giftCatalog] listener error:', e); }
    });
  };

  onValue(catalogRef, handler);

  return () => {
    off(catalogRef, 'value', handler);
    listeners = listeners.filter(l => l !== callback);
  };
}

/**
 * Get gifts by category from cache (or fetch if needed).
 */
export async function getGiftsByCategory(category: GiftCategory): Promise<CatalogGift[]> {
  const gifts = cachedGifts || await fetchGiftCatalog();
  return gifts.filter(g => g.category === category);
}

/**
 * Get price for a gift ID (for wallet transactions).
 * Falls back to server catalog; returns 0 if not found.
 */
export async function getGiftPrice(giftId: string): Promise<number> {
  const gifts = cachedGifts || await fetchGiftCatalog();
  const gift = gifts.find(g => g.id === giftId);
  return gift ? gift.price : 0;
}

/**
 * Clear cache (for testing).
 */
export function clearGiftCatalogCache(): void {
  cachedGifts = null;
}
