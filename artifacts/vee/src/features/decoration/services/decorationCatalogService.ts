/**
 * 2026-10-16 (Sumon): Unified server-driven decoration catalog.
 * ALL app decorations come from server — badges, frames, nameplates, ripples, entry effects.
 * RTDB: `decoration_catalog/{category}/{itemId}`
 * Categories: badge | frame | nameplate | ripple | entry_effect | profile_skin
 * No app build needed to add/update decorations.
 */

import { ref, onValue, off, get } from 'firebase/database';
import { rtdb } from '@/src/services/firebase';

export type DecorationCategory =
  | 'badge'
  | 'frame'
  | 'nameplate'
  | 'ripple'
  | 'entry_effect'
  | 'profile_skin';

export interface CatalogDecoration {
  id: string;
  category: DecorationCategory;
  name: string;
  description?: string;
  imageUrl: string;           // Thumbnail/preview
  animationUrl?: string;      // Full animation (video)
  animationType?: 'video' | 'image' | 'none';
  price?: number;             // Diamonds (0 = free)
  currency?: 'diamond' | 'coin';
  sortOrder: number;
  active: boolean;
  // Category-specific
  nobleRank?: string;         // For noble rewards
  validityDays?: number;      // Expiry
}

const CATALOG_PATH = 'decoration_catalog';

// Cache per category
const cache: Record<string, CatalogDecoration[] | null> = {};
const listeners: Record<string, Array<(items: CatalogDecoration[]) => void>> = {};

function normalizeDecoration(
  category: DecorationCategory,
  id: string,
  data: any
): CatalogDecoration | null {
  if (!data || typeof data !== 'object') return null;
  if (data.active === false) return null;

  return {
    id,
    category,
    name: String(data.name || id),
    description: data.description ? String(data.description) : undefined,
    imageUrl: String(data.imageUrl || ''),
    animationUrl: data.animationUrl ? String(data.animationUrl) : undefined,
    animationType: data.animationType || 'none',
    price: Number(data.price) || 0,
    currency: data.currency || 'diamond',
    sortOrder: Number(data.sortOrder) || 0,
    active: true,
    nobleRank: data.nobleRank ? String(data.nobleRank) : undefined,
    validityDays: data.validityDays ? Number(data.validityDays) : undefined,
  };
}

function sortDecorations(items: CatalogDecoration[]): CatalogDecoration[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fetch decorations for a category once.
 */
export async function fetchDecorations(
  category: DecorationCategory
): Promise<CatalogDecoration[]> {
  try {
    const snap = await get(ref(rtdb, `${CATALOG_PATH}/${category}`));
    if (!snap.exists()) {
      cache[category] = [];
      return [];
    }
    const data = snap.val();
    const items: CatalogDecoration[] = [];
    for (const [id, itemData] of Object.entries(data)) {
      const item = normalizeDecoration(category, id, itemData);
      // Only include items with images (no broken visuals)
      if (item && item.imageUrl) items.push(item);
    }
    cache[category] = sortDecorations(items);
    return cache[category]!;
  } catch (e) {
    console.warn(`[decorationCatalog] fetch ${category} failed:`, e);
    return cache[category] || [];
  }
}

/**
 * Subscribe to decoration changes (real-time).
 */
export function subscribeDecorations(
  category: DecorationCategory,
  callback: (items: CatalogDecoration[]) => void
): () => void {
  if (!listeners[category]) listeners[category] = [];
  listeners[category].push(callback);

  if (cache[category]) {
    callback(cache[category]!);
  }

  const catRef = ref(rtdb, `${CATALOG_PATH}/${category}`);
  const handler = (snap: any) => {
    const items: CatalogDecoration[] = [];
    if (snap.exists()) {
      const data = snap.val();
      for (const [id, itemData] of Object.entries(data)) {
        const item = normalizeDecoration(category, id, itemData);
        if (item && item.imageUrl) items.push(item);
      }
    }
    cache[category] = sortDecorations(items);
    (listeners[category] || []).forEach(l => {
      try { l(cache[category]!); } catch (e) { console.warn('[decorationCatalog] listener error:', e); }
    });
  };

  onValue(catRef, handler);

  return () => {
    off(catRef, 'value', handler);
    listeners[category] = (listeners[category] || []).filter(l => l !== callback);
  };
}

/**
 * Fetch all categories at once.
 */
export async function fetchAllDecorations(): Promise<Record<DecorationCategory, CatalogDecoration[]>> {
  const categories: DecorationCategory[] = ['badge', 'frame', 'nameplate', 'ripple', 'entry_effect', 'profile_skin'];
  const result = {} as Record<DecorationCategory, CatalogDecoration[]>;
  await Promise.all(
    categories.map(async (cat) => {
      result[cat] = await fetchDecorations(cat);
    })
  );
  return result;
}

/**
 * Clear cache for a category (or all).
 */
export function clearDecorationCache(category?: DecorationCategory): void {
  if (category) {
    cache[category] = null;
  } else {
    Object.keys(cache).forEach(k => { cache[k] = null; });
  }
}
