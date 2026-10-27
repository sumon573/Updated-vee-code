/**
 * roomMusicService.ts — room-wide music (2026-10-25, boss: everyone in the
 * room hears; phone music only; no YouTube).
 *
 * Architecture: a VPS bot (C:\vee-music-bot\bot.cjs, task VeeMusic) streams
 * into the LiveKit room via a WHIP ingress, so every member hears the same
 * track in sync. The app cannot publish a phone file as a LiveKit track
 * (mic tracks only) and no new native module is allowed (no-builds rule),
 * so the bot is the only no-build path.
 *
 * RTDB contract — roomMusic/{roomId}:
 *   queue: { pushId: { title, url, mediaId, addedBy, addedByName, addedAt,
 *     durationSec? } }
 *   state: 'playing' | 'paused' | 'stopped' | 'idle'   (client writes)
 *   current: { queueId, title, url, mediaId, positionSec, startedAt,
 *     durationSec? }
 *     — BOT-ONLY (live rules deny client writes to `current`).
 *   playQueueId: queueId (client writes; BOT consumes it FIRST in
 *     reconcile — plays that queued song directly, then clears it.
 *     Needs its own live-rules entry; see the deploy report.)
 * The bot reconciles (state, current, queue): 'playing' starts/resumes,
 * 'paused' stops at the saved position, 'next' advances, 'stopped' keeps
 * the song (positionSec reset to 0) so Play restarts it from the start.
 * Client writes are owner/admin-gated by the live rules; members read.
 *
 * Per-user library — users/{uid}/musicLibrary/{pushId}:
 *   { mediaId, url, title, assetId, duration, addedAt }
 * Written once per successful phone upload; any room can queue a library
 * song without re-uploading. Owner-writable under the live users/$uid
 * rule already (no rules change needed for function; see the report for
 * the optional shape-validation patch). Capped at 200, oldest pruned.
 */

import { ref, push, set, remove, onValue, get, query, orderByChild, equalTo } from 'firebase/database';
import { database, auth } from '@/src/config/firebase';

export type MusicState = 'playing' | 'paused' | 'stopped' | 'idle' | 'next';

export interface MusicTrack {
  queueId: string;
  title: string;
  url: string;
  mediaId: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
  /** Track length in seconds when known (library/phone duration). Old queue
   * items lack it — the player bar then shows elapsed time only, never a
   * guessed total. */
  durationSec?: number | null;
}

export interface MusicCurrent extends MusicTrack {
  positionSec: number;
  startedAt: number;
}

export interface RoomMusic {
  queue: MusicTrack[];
  state: MusicState;
  current: MusicCurrent | null;
}

function musicRef(roomId: string) {
  return ref(database, `roomMusic/${roomId}`);
}

/** Live room-music state (null when the room never had music). */
export function subscribeRoomMusic(
  roomId: string,
  cb: (m: RoomMusic | null) => void,
): () => void {
  return onValue(musicRef(roomId), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    const v = snap.val() as any;
    const queue: MusicTrack[] = v.queue
      ? Object.keys(v.queue)
          .map((k) => ({ queueId: k, ...(v.queue[k] as object) } as MusicTrack))
          .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
      : [];
    // 'next' is transient (the bot converts it to playing/idle at once);
    // display it as playing so the UI never flickers to a dead state.
    const rawState = (v.state as MusicState) || 'idle';
    cb({
      queue,
      state: rawState === 'next' ? 'playing' : rawState,
      current: (v.current as MusicCurrent) || null,
    });
  });
}

/** Append a track to the queue (owner/admin only, per live rules). */
export async function addMusicTrack(
  roomId: string,
  track: { title: string; url: string; mediaId: string; durationSec?: number | null },
  addedByName: string,
): Promise<string> {
  const uid = auth.currentUser?.uid ?? 'anonymous';
  const payload: Record<string, unknown> = {
    ...track,
    addedBy: uid,
    addedByName,
    addedAt: Date.now(),
  };
  if (track.durationSec == null) delete payload.durationSec;
  const newRef = await push(ref(database, `roomMusic/${roomId}/queue`), payload);
  return newRef.key ?? '';
}

/**
 * Tap-to-play: ask the bot to play one queued song directly. The bot
 * consumes this FIRST in reconcile (removes the song from the queue,
 * clears the field, starts it) — so a stale/missing id just clears and
 * normal handling continues. Client write is owner/admin-gated by the
 * live rules (playQueueId entry required — see the deploy report).
 */
export async function setPlayQueueId(roomId: string, queueId: string): Promise<void> {
  await set(ref(database, `roomMusic/${roomId}/playQueueId`), queueId);
}

/** Drive playback: 'playing' | 'paused' | 'next' | 'stopped'. */
export async function setMusicState(roomId: string, state: MusicState): Promise<void> {
  await set(ref(database, `roomMusic/${roomId}/state`), state);
}

/** Remove one queued track (owner/admin only). */
export async function removeQueueTrack(roomId: string, queueId: string): Promise<void> {
  await remove(ref(database, `roomMusic/${roomId}/queue/${queueId}`));
}

/** One song in the user's own library (shared by every room). */
export interface MusicLibraryEntry {
  libraryKey: string;
  mediaId: string;
  url: string;
  title: string;
  assetId: string | null;
  duration: number | null;
  addedAt: number;
}

function libraryRef(uid: string) {
  return ref(database, `users/${uid}/musicLibrary`);
}

/** The user's own song library, newest first (empty when signed out/none). */
export function subscribeMusicLibrary(
  uid: string,
  cb: (entries: MusicLibraryEntry[]) => void,
): () => void {
  return onValue(libraryRef(uid), (snap) => {
    if (!snap.exists()) {
      cb([]);
      return;
    }
    const v = snap.val() as Record<string, any>;
    cb(
      Object.keys(v)
        .map((k) => ({ libraryKey: k, ...(v[k] as object) } as MusicLibraryEntry))
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)),
    );
  });
}

const MUSIC_LIBRARY_CAP = 200;

/**
 * One-shot read of a user's library (for batch Add dedup — one read
 * instead of one RTDB query per song).
 */
export async function getMusicLibraryOnce(uid: string): Promise<MusicLibraryEntry[]> {
  const snap = await get(libraryRef(uid));
  if (!snap.exists()) return [];
  const v = snap.val() as Record<string, any>;
  return Object.keys(v)
    .map((k) => ({ libraryKey: k, ...(v[k] as object) } as MusicLibraryEntry))
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

/**
 * Save several uploaded songs at once (batch Add): all sets in parallel,
 * then ONE library read + ONE prune pass. Same semantics as
 * saveMusicLibraryEntry per song (cap 200, oldest pruned) without the
 * per-song full-library GET — the Add flow's wasted round-trips. A
 * failed batch leaves already-set entries in place; the next batch's
 * dedup read skips them, so a retry never duplicates.
 */
export async function saveMusicLibraryEntries(
  uid: string,
  entries: Array<Omit<MusicLibraryEntry, 'libraryKey'>>,
): Promise<void> {
  if (entries.length === 0) return;
  const refs = entries.map(() => push(libraryRef(uid)));
  await Promise.all(entries.map((e, i) => set(refs[i], e)));
  const snap = await get(libraryRef(uid));
  if (!snap.exists()) return;
  const v = snap.val() as Record<string, any>;
  const sorted = Object.keys(v).sort((a, b) => (v[a].addedAt || 0) - (v[b].addedAt || 0));
  if (sorted.length > MUSIC_LIBRARY_CAP) {
    const extra = sorted.slice(0, sorted.length - MUSIC_LIBRARY_CAP);
    await Promise.all(extra.map((k) => remove(ref(database, `users/${uid}/musicLibrary/${k}`))));
  }
}

/**
 * Save one uploaded song to the user's library. Prunes the oldest entries
 * beyond the cap (rare: only when at the cap, and user-paced).
 */
export async function saveMusicLibraryEntry(
  uid: string,
  entry: Omit<MusicLibraryEntry, 'libraryKey'>,
): Promise<void> {
  const key = push(libraryRef(uid)).key;
  if (!key) return;
  await set(ref(database, `users/${uid}/musicLibrary/${key}`), entry);
  const snap = await get(libraryRef(uid));
  if (!snap.exists()) return;
  const v = snap.val() as Record<string, any>;
  const keys = Object.keys(v).sort((a, b) => (v[a].addedAt || 0) - (v[b].addedAt || 0));
  if (keys.length > MUSIC_LIBRARY_CAP) {
    const extra = keys.slice(0, keys.length - MUSIC_LIBRARY_CAP);
    await Promise.all(extra.map((k) => remove(ref(database, `users/${uid}/musicLibrary/${k}`))));
  }
}

/** Remove one library entry (delete flow; the room queue is untouched). */
export async function removeMusicLibraryEntry(uid: string, libraryKey: string): Promise<void> {
  await remove(ref(database, `users/${uid}/musicLibrary/${libraryKey}`));
}

/** Find a library entry for a phone asset (same-device dedup). Null when absent. */
export async function findLibraryEntryByAsset(
  uid: string,
  assetId: string,
): Promise<MusicLibraryEntry | null> {
  const q = query(libraryRef(uid), orderByChild('assetId'), equalTo(assetId));
  const snap = await get(q);
  if (!snap.exists()) return null;
  const v = snap.val() as Record<string, any>;
  const keys = Object.keys(v).sort((a, b) => (v[b].addedAt || 0) - (v[a].addedAt || 0));
  const k = keys[0];
  return { libraryKey: k, ...(v[k] as object) } as MusicLibraryEntry;
}

/**
 * Fresh one-shot read of a room's music node — for post-add autoplay
 * decisions. Never trust a render closure for this: after a Stop the room
 * can sit in 'stopped' until the bot converts it to 'idle', and a stale
 * closure check misses exactly that window.
 */
export async function getRoomMusicOnce(
  roomId: string,
): Promise<{ state: MusicState; current: MusicCurrent | null; queueCount: number } | null> {
  const snap = await get(musicRef(roomId));
  if (!snap.exists()) return null;
  const v = snap.val() as any;
  return {
    state: (v.state as MusicState) || 'idle',
    current: (v.current as MusicCurrent) || null,
    queueCount: v.queue ? Object.keys(v.queue).length : 0,
  };
}

const MEDIA_BASE = 'https://vee-club.duckdns.org';

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
    case 'aac':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/mpeg';
  }
}

/**
 * Upload a phone audio file to the media server (Telegram-backed, permanent,
 * same endpoint stories/chat use; 50 MB cap). Returns the public /m/ URL
 * the music bot downloads from. One retry on transient failure.
 */
export async function uploadMusicFile(asset: {
  uri: string;
  filename?: string | null;
}): Promise<{ mediaId: string; url: string }> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  const filename = asset.filename || `music-${Date.now()}.mp3`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = new FormData();
      body.append('file', { uri: asset.uri, name: filename, type: mimeFor(filename) } as any);
      body.append('type', 'chat');
      const res = await fetch(`${MEDIA_BASE}/api/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: unknown };
        const msg =
          typeof err?.error === 'string' && err.error
            ? err.error
            : `Upload failed (${res.status})`;
        throw new Error(msg);
      }
      // Never trust the shape: a 200 with no mediaId/url would otherwise
      // queue an unplayable track (the bot downloads track.url).
      const data = (await res.json().catch(() => null)) as {
        mediaId?: unknown;
        url?: unknown;
      } | null;
      if (
        typeof data?.mediaId !== 'string' ||
        !data.mediaId ||
        typeof data?.url !== 'string' ||
        !data.url
      ) {
        throw new Error('Upload failed: media server returned no media id or URL');
      }
      return { mediaId: data.mediaId, url: data.url };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt === 0) continue;
      throw lastErr;
    }
  }
  throw lastErr ?? new Error('Upload failed');
}

/**
 * User-facing message for an upload failure. The media server can return raw
 * engine errors (e.g. a Telegram `file_id` TypeError when an audio file is
 * reclassified server-side) — those must never reach the user verbatim in an
 * alert. The raw message is still logged for debugging.
 */
export function friendlyUploadError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  if (raw) console.warn('[music upload] failed:', raw);
  if (/not signed in|not authenticated|401/i.test(raw)) {
    return 'Please sign in again, then try adding the song.';
  }
  if (/network|failed to fetch|timeout|timed out|aborted/i.test(raw)) {
    return 'No connection — check your network and try again.';
  }
  if (/too large|file size|413/i.test(raw)) {
    return 'This song is too large to upload (50 MB limit).';
  }
  if (/50[0-9]|telegram|media server|bad response/i.test(raw)) {
    return 'The media server had a problem — please try again.';
  }
  if (/cannot read properties|undefined|file_id|null|is not a function/i.test(raw)) {
    return 'Could not upload this song. Please try again.';
  }
  return 'Could not upload this song. Please try again.';
}
