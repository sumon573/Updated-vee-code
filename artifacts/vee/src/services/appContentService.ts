/**
 * 2026-10-16 (Sumon): Universal server-driven app content system.
 * Show ANY content ANYWHERE in the app — controlled entirely from server.
 * 
 * RTDB: `app_content/{contentId}`
 * 
 * Target locations (where to show):
 *   - 'home' : Home screen
 *   - 'voice_room' : Inside voice rooms
 *   - 'voice_room_banner' : Top banner in voice room
 *   - 'profile' : Profile screen
 *   - 'store' : Store screen
 *   - 'global' : Everywhere (app-wide)
 *   - Custom locations can be added from server without code change
 * 
 * Content types:
 *   - 'banner' : Horizontal banner
 *   - 'popup' : Modal popup
 *   - 'fullscreen' : Full-screen takeover
 *   - 'floating' : Floating widget
 *   - 'announcement' : Top announcement bar
 * 
 * Display rules:
 *   - startTime/endTime: when to show
 *   - maxShows: max times to show per user
 *   - targetUsers: 'all' | specific UIDs | 'noble:{rank}' | 'level:{min}'
 */

import { ref, onValue, off, get } from 'firebase/database';
import { database } from '@/src/config/firebase';

export interface AppContent {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  actionUrl?: string;      // Deep link or URL on tap
  actionType?: string;     // 'open_url' | 'open_screen' | 'join_room' | 'none'
  actionData?: Record<string, unknown>;
  // Placement
  locations: string[];     // Where to show: ['home', 'voice_room', ...]
  contentType: string;     // 'banner' | 'popup' | 'fullscreen' | 'floating' | 'announcement'
  position?: string;       // 'top' | 'bottom' | 'center' (for banners/floating)
  // Timing
  startTime?: number;
  endTime?: number;
  // Targeting
  targetUsers?: string;    // 'all' | 'noble:king' | 'level:10' | comma-separated UIDs
  maxShows?: number;       // Max displays per user (0 = unlimited)
  // Display
  sortOrder: number;
  active: boolean;
  // Future-proof
  metadata?: Record<string, unknown>;
}

const CONTENT_PATH = 'app_content';

let cachedContent: AppContent[] | null = null;
let listeners: Array<(content: AppContent[]) => void> = [];

function normalizeContent(id: string, data: any): AppContent | null {
  if (!data || typeof data !== 'object') return null;
  if (data.active === false) return null;

  // Time validity
  const now = Date.now();
  if (data.startTime && now < Number(data.startTime)) return null;
  if (data.endTime && now > Number(data.endTime)) return null;

  // Locations (required)
  let locations: string[] = [];
  if (Array.isArray(data.locations)) {
    locations = data.locations.map((l: any) => String(l).trim()).filter(Boolean);
  } else if (typeof data.locations === 'string') {
    locations = data.locations.split(',').map((l: string) => l.trim()).filter(Boolean);
  }
  if (locations.length === 0) return null; // No target = don't show

  // Preserve unknown fields
  const knownKeys = new Set(['title', 'description', 'imageUrl', 'actionUrl', 'actionType',
    'actionData', 'locations', 'contentType', 'position', 'startTime', 'endTime',
    'targetUsers', 'maxShows', 'sortOrder', 'active']);
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!knownKeys.has(k)) metadata[k] = v;
  }

  return {
    id,
    title: String(data.title || id),
    description: data.description ? String(data.description) : undefined,
    imageUrl: String(data.imageUrl || ''),
    actionUrl: data.actionUrl ? String(data.actionUrl) : undefined,
    actionType: data.actionType ? String(data.actionType) : 'none',
    actionData: data.actionData || undefined,
    locations,
    contentType: data.contentType ? String(data.contentType) : 'banner',
    position: data.position ? String(data.position) : undefined,
    startTime: data.startTime ? Number(data.startTime) : undefined,
    endTime: data.endTime ? Number(data.endTime) : undefined,
    targetUsers: data.targetUsers ? String(data.targetUsers) : 'all',
    maxShows: data.maxShows ? Number(data.maxShows) : 0,
    sortOrder: Number(data.sortOrder) || 0,
    active: true,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function sortContent(items: AppContent[]): AppContent[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Check if content targets a specific user.
 */
export function contentTargetsUser(content: AppContent, uid: string, userLevel?: number, nobleRank?: string): boolean {
  const target = content.targetUsers || 'all';
  if (target === 'all') return true;
  
  // Comma-separated UIDs
  const targets = target.split(',').map(t => t.trim());
  if (targets.includes(uid)) return true;
  
  // Level targeting: 'level:10' means level >= 10
  if (userLevel !== undefined) {
    for (const t of targets) {
      if (t.startsWith('level:')) {
        const minLevel = parseInt(t.split(':')[1], 10);
        if (!isNaN(minLevel) && userLevel >= minLevel) return true;
      }
    }
  }
  
  // Noble rank targeting: 'noble:king'
  if (nobleRank) {
    for (const t of targets) {
      if (t.startsWith('noble:')) {
        const rank = t.split(':')[1];
        if (rank === nobleRank) return true;
      }
    }
  }
  
  return false;
}

/**
 * Fetch all app content once.
 */
export async function fetchAppContent(): Promise<AppContent[]> {
  try {
    const snap = await get(ref(database, CONTENT_PATH));
    if (!snap.exists()) {
      cachedContent = [];
      return [];
    }
    const data = snap.val();
    const items: AppContent[] = [];
    for (const [id, contentData] of Object.entries(data)) {
      const item = normalizeContent(id, contentData);
      if (item && item.imageUrl) items.push(item);
    }
    cachedContent = sortContent(items);
    return cachedContent;
  } catch (e) {
    console.warn('[appContent] fetch failed:', e);
    return cachedContent || [];
  }
}

/**
 * Get content for a specific location.
 */
export async function getContentForLocation(
  location: string,
  uid?: string,
  userLevel?: number,
  nobleRank?: string
): Promise<AppContent[]> {
  const all = cachedContent || await fetchAppContent();
  return all.filter(c => {
    if (!c.locations.includes(location) && !c.locations.includes('global')) return false;
    if (uid && !contentTargetsUser(c, uid, userLevel, nobleRank)) return false;
    return true;
  });
}

/**
 * Subscribe to app content changes (real-time).
 */
export function subscribeAppContent(callback: (content: AppContent[]) => void): () => void {
  listeners.push(callback);

  if (cachedContent) {
    callback(cachedContent);
  }

  const contentRef = ref(database, CONTENT_PATH);
  const handler = (snap: any) => {
    const items: AppContent[] = [];
    if (snap.exists()) {
      const data = snap.val();
      for (const [id, contentData] of Object.entries(data)) {
        const item = normalizeContent(id, contentData);
        if (item && item.imageUrl) items.push(item);
      }
    }
    cachedContent = sortContent(items);
    listeners.forEach(l => {
      try { l(cachedContent!); } catch (e) { console.warn('[appContent] listener error:', e); }
    });
  };

  onValue(contentRef, handler);

  return () => {
    off(contentRef, 'value', handler);
    listeners = listeners.filter(l => l !== callback);
  };
}

/**
 * Clear cache.
 */
export function clearAppContentCache(): void {
  cachedContent = null;
}
