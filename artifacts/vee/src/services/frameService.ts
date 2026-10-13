import { ref, set, remove, get } from 'firebase/database';
// 2026-10-13 (Sumon): expo-file-system v19 moved the classic API to /legacy
import * as FileSystem from 'expo-file-system/legacy';
import { database } from '../config/firebase';

/**
 * Frame equip/unequip service.
 * 2026-10-13 (Sumon): Use = frame shows on DP (profile + rooms).
 * Remove = frame hidden. Only one frame active at a time.
 */

/** Equip a frame — sets users/{uid}/activeFrame */
export async function equipFrame(uid: string, frameId: string): Promise<void> {
  await set(ref(database, `users/${uid}/activeFrame`), frameId);
}

/** Unequip — removes activeFrame, DP shows without frame */
export async function unequipFrame(uid: string): Promise<void> {
  await remove(ref(database, `users/${uid}/activeFrame`));
}

/* ─────────────────────────────────────────────────────────────
 * 2026-10-13 (Sumon): SERVER-HOSTED ANIMATED FRAMES.
 * Frames are NOT bundled in the APK (Sumon will add many frames —
 * bundling would bloat the app). Instead:
 *   1. Admin sets the frame's APNG URL in honors_catalog/{frameId}/animationUrl
 *      (VPS static: https://vee-club.duckdns.org/static/frames/*.png)
 *   2. App downloads once, caches in app storage, reuses offline.
 *   3. Admin can swap/update a frame's animation WITHOUT an app update.
 * ───────────────────────────────────────────────────────────── */

/** Base URL for frame APNGs on Sumon's VPS (zero recurring cost). */
export const FRAME_SERVER_BASE = 'https://vee-club.duckdns.org/static/frames';

const FRAMES_CACHE_DIR = `${FileSystem.cacheDirectory}frames/`;

// In-memory cache: frameId -> resolved animation URL (null = none/server failed)
const animationUrlCache: Record<string, string | null> = {};
const animationUrlPromises: Record<string, Promise<string | null>> = {};

/**
 * Resolve the server APNG URL for a frame.
 * Source of truth: honors_catalog/{frameId}/animationUrl (admin-controlled).
 * Convention fallback: {FRAME_SERVER_BASE}/{frameId}.png
 */
export async function getFrameAnimationUrl(frameId: string): Promise<string | null> {
  if (!frameId) return null;
  if (frameId in animationUrlCache) return animationUrlCache[frameId];
  const pending = animationUrlPromises[frameId];
  if (pending) return pending;

  animationUrlPromises[frameId] = (async () => {
    try {
      const snap = await get(ref(database, `honors_catalog/${frameId}/animationUrl`));
      const url = snap.exists() ? (snap.val() as unknown) : null;
      if (typeof url === 'string' && url.startsWith('http')) {
        animationUrlCache[frameId] = url;
        return url;
      }
    } catch {
      // fall through to convention fallback
    }
    // Convention fallback — lets Sumon drop a file on the VPS without touching the catalog.
    const conventional = `${FRAME_SERVER_BASE}/${frameId}.png`;
    animationUrlCache[frameId] = conventional;
    return conventional;
  })();

  try {
    return await animationUrlPromises[frameId];
  } finally {
    delete animationUrlPromises[frameId];
  }
}

/** Clear cached animation URLs (call after admin updates a frame). */
export function clearFrameAnimationUrlCache(frameId?: string) {
  if (frameId) {
    delete animationUrlCache[frameId];
  } else {
    for (const k of Object.keys(animationUrlCache)) delete animationUrlCache[k];
  }
}

async function ensureCacheDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(FRAMES_CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(FRAMES_CACHE_DIR, { intermediates: true });
    }
  } catch {
    // non-fatal — download will fail and caller falls back
  }
}

/**
 * Get a local (cached) file URI for the frame's APNG.
 * Downloads once, then reuses the cached copy offline.
 * Returns null if the download fails (caller uses bundled fallback).
 */
export async function getCachedFrameUri(frameId: string): Promise<string | null> {
  if (!frameId) return null;
  const url = await getFrameAnimationUrl(frameId);
  if (!url) return null;

  const localPath = `${FRAMES_CACHE_DIR}${frameId}.png`;
  try {
    await ensureCacheDir();
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) return localPath;
    const dl = await FileSystem.downloadAsync(url, localPath);
    if (dl.status === 200) return dl.uri;
    // Cleanup partial file
    try { await FileSystem.deleteAsync(localPath, { idempotent: true }); } catch { /* ignore */ }
    return null;
  } catch {
    return null;
  }
}

/** Delete cached frame file(s) — forces re-download next time. */
export async function clearFrameFileCache(frameId?: string): Promise<void> {
  try {
    if (frameId) {
      await FileSystem.deleteAsync(`${FRAMES_CACHE_DIR}${frameId}.png`, { idempotent: true });
    } else {
      const info = await FileSystem.getInfoAsync(FRAMES_CACHE_DIR);
      if (info.exists) await FileSystem.deleteAsync(FRAMES_CACHE_DIR, { idempotent: true });
    }
  } catch {
    // ignore
  }
  clearFrameAnimationUrlCache(frameId);
}
