/**
 * 2026-10-16 (Sumon): Server-driven Task Center events.
 * Events inside Task Center come from RTDB — no app build needed.
 * RTDB: `task_events/{eventId}`
 * 
 * Structure:
 *   id, title, description, imageUrl, bannerUrl,
 *   rewardType (diamond|coin|badge|frame), rewardAmount, rewardId,
 *   startTime, endTime, sortOrder, active,
 *   actionType (join_room|send_gift|daily_login|custom), actionData
 */

import { ref, onValue, off, get } from 'firebase/database';
import { database as rtdb } from '@/src/config/firebase';

export interface EventTier {
  id: string;
  minutes: number;
  title?: string;
  rewardType: string;
  rewardId?: string;
  validityDays?: number;
  params?: Record<string, unknown>;
}

export interface TaskEvent {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  bannerUrl?: string;
  // Reward
  rewardType: string; // 'diamond' | 'coin' | 'badge' | 'frame' | 'none'
  rewardAmount?: number;
  rewardId?: string; // For badge/frame rewards
  // Timing
  startTime?: number; // Unix timestamp ms
  endTime?: number;   // Unix timestamp ms
  // Action
  actionType: string; // 'join_room' | 'send_gift' | 'daily_login' | 'custom'
  actionData?: Record<string, unknown>;
  // Display
  sortOrder: number;
  active: boolean;
  // Event Engine v1 (2026-10-26): structured tiers + progress metric.
  tiers?: EventTier[];
  progressType?: string;
  // Future-proof
  metadata?: Record<string, unknown>;
}

const EVENTS_PATH = 'task_events';

let cachedEvents: TaskEvent[] | null = null;
let listeners: Array<(events: TaskEvent[]) => void> = [];

function normalizeEvent(id: string, data: any): TaskEvent | null {
  if (!data || typeof data !== 'object') return null;
  if (data.active === false) return null;

  // Check time validity
  const now = Date.now();
  if (data.startTime && now < Number(data.startTime)) return null; // Not started
  if (data.endTime && now > Number(data.endTime)) return null;     // Expired

  // Preserve unknown fields
  const knownKeys = new Set(['title', 'description', 'imageUrl', 'bannerUrl',
    'rewardType', 'rewardAmount', 'rewardId', 'startTime', 'endTime',
    'actionType', 'actionData', 'sortOrder', 'active', 'tiers', 'progressType']);
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!knownKeys.has(k)) metadata[k] = v;
  }

  return {
    id,
    title: String(data.title || id),
    description: String(data.description || ''),
    imageUrl: String(data.imageUrl || ''),
    bannerUrl: data.bannerUrl ? String(data.bannerUrl) : undefined,
    rewardType: data.rewardType ? String(data.rewardType) : 'none',
    rewardAmount: data.rewardAmount ? Number(data.rewardAmount) : undefined,
    rewardId: data.rewardId ? String(data.rewardId) : undefined,
    startTime: data.startTime ? Number(data.startTime) : undefined,
    endTime: data.endTime ? Number(data.endTime) : undefined,
    actionType: data.actionType ? String(data.actionType) : 'custom',
    actionData: data.actionData || undefined,
    tiers: Array.isArray(data.tiers)
      ? (data.tiers as unknown[]).filter((x): x is Record<string, unknown> =>
          !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).id === 'string'
          && !!((x as Record<string, unknown>).id as string)
          && Number.isFinite(Number((x as Record<string, unknown>).minutes))).map((x) => ({
        id: String(x.id),
        minutes: Math.max(0, Math.floor(Number(x.minutes))),
        title: x.title ? String(x.title) : undefined,
        rewardType: x.rewardType ? String(x.rewardType) : 'none',
        rewardId: x.rewardId ? String(x.rewardId) : undefined,
        validityDays: Number.isFinite(Number(x.validityDays))
          ? Math.max(0, Math.floor(Number(x.validityDays))) : undefined,
        params: x.params && typeof x.params === 'object'
          ? (x.params as Record<string, unknown>) : undefined,
      }))
      : undefined,
    progressType: data.progressType ? String(data.progressType) : undefined,
    sortOrder: Number(data.sortOrder) || 0,
    active: true,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function sortEvents(events: TaskEvent[]): TaskEvent[] {
  return [...events].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Fetch task events once from server.
 */
export async function fetchTaskEvents(): Promise<TaskEvent[]> {
  try {
    const snap = await get(ref(rtdb, EVENTS_PATH));
    if (!snap.exists()) {
      cachedEvents = [];
      return [];
    }
    const data = snap.val();
    const events: TaskEvent[] = [];
    for (const [id, eventData] of Object.entries(data)) {
      const event = normalizeEvent(id, eventData);
      // Every active event shows (imageless events get a placeholder tile).
      if (event) events.push(event);
    }
    cachedEvents = sortEvents(events);
    return cachedEvents;
  } catch (e) {
    console.warn('[taskEvents] fetch failed:', e);
    return cachedEvents || [];
  }
}

/**
 * Subscribe to task events (real-time).
 */
export function subscribeTaskEvents(callback: (events: TaskEvent[]) => void): () => void {
  listeners.push(callback);

  if (cachedEvents) {
    callback(cachedEvents);
  }

  const eventsRef = ref(rtdb, EVENTS_PATH);
  const handler = (snap: any) => {
    const events: TaskEvent[] = [];
    if (snap.exists()) {
      const data = snap.val();
      for (const [id, eventData] of Object.entries(data)) {
        const event = normalizeEvent(id, eventData);
        if (event) events.push(event);
      }
    }
    cachedEvents = sortEvents(events);
    listeners.forEach(l => {
      try { l(cachedEvents!); } catch (e) { console.warn('[taskEvents] listener error:', e); }
    });
  };

  onValue(eventsRef, handler);

  return () => {
    off(eventsRef, 'value', handler);
    listeners = listeners.filter(l => l !== callback);
  };
}

/**
 * Clear cache.
 */
export function clearTaskEventsCache(): void {
  cachedEvents = null;
}
