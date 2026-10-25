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
 *   queue: { pushId: { title, url, mediaId, addedBy, addedByName, addedAt } }
 *   state: 'playing' | 'paused' | 'stopped' | 'idle'   (client writes)
 *   current: { queueId, title, url, mediaId, positionSec, startedAt }
 *     — BOT-ONLY (live rules deny client writes to `current`).
 * The bot reconciles (state, current, queue): 'playing' starts/resumes,
 * 'paused' stops at the saved position, 'next' advances, 'stopped' clears.
 * Client writes are owner/admin-gated by the live rules; members read.
 */

import { ref, push, set, remove, onValue } from 'firebase/database';
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
  track: { title: string; url: string; mediaId: string },
  addedByName: string,
): Promise<void> {
  const uid = auth.currentUser?.uid ?? 'anonymous';
  await push(ref(database, `roomMusic/${roomId}/queue`), {
    ...track,
    addedBy: uid,
    addedByName,
    addedAt: Date.now(),
  });
}

/** Drive playback: 'playing' | 'paused' | 'next' | 'stopped'. */
export async function setMusicState(roomId: string, state: MusicState): Promise<void> {
  await set(ref(database, `roomMusic/${roomId}/state`), state);
}

/** Remove one queued track (owner/admin only). */
export async function removeQueueTrack(roomId: string, queueId: string): Promise<void> {
  await remove(ref(database, `roomMusic/${roomId}/queue/${queueId}`));
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
