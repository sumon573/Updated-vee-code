/**
 * Media Service — Telegram-backed permanent storage (2026-10-18, Sumon)
 *
 * ALL app media uploads go through this file. Previously Cloudinary;
 * now posts to the Vee media server (https://vee-club.duckdns.org)
 * which stores permanently on Telegram (free, unlimited).
 *
 * The exported interface is UNCHANGED — zero caller changes needed.
 * Supports: profile photos, story images/videos/audio, room covers.
 */

import { auth } from '../config/firebase';
import { File } from 'expo-file-system';

const MEDIA_BASE = 'https://vee-club.duckdns.org';

/**
 * FIX (2026-10-19): the media server posts through the Telegram Bot API,
 * which caps files at 50 MB. Stat the file upfront and fail fast with a
 * clear message instead of a long upload that dies server-side.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

async function assertUploadSizeOk(localUri: string): Promise<void> {
  try {
    const f = new File(localUri);
    if (!f.exists) return; // stat unavailable (remote URI etc.) — let the server decide
    const size = f.size;
    if (typeof size === 'number' && size > MAX_UPLOAD_BYTES) {
      const mb = (size / (1024 * 1024)).toFixed(1);
      throw new Error(
        `File too large (${mb} MB). Maximum upload size is 50 MB — please pick a smaller file.`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('File too large')) throw e;
    // Stat failed for any other reason — proceed; the server decides.
  }
}

function buildFormData(localUri: string, mime: string, fileName: string, type: string): FormData {
  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: mime,
    name: fileName,
  } as unknown as Blob);
  formData.append('type', type);
  return formData;
}

/**
 * FIX (2026-10-19): POST with one retry on transient failure.
 * - Network-level failure (fetch throws before a response): one retry.
 * - HTTP 5xx: one retry. HTTP 4xx (auth/validation): fail fast, no retry.
 * - Aborted (caller cancelled, e.g. screen unmounted): always throws
 *   'Upload cancelled' immediately, never retried.
 * The body is rebuilt per attempt — a consumed FormData cannot be re-sent.
 */
async function postUpload(
  buildBody: () => FormData,
  idToken: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error('Upload cancelled');
    let response: Response;
    try {
      response = await fetch(`${MEDIA_BASE}/api/media/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: buildBody(),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if ((e instanceof Error && e.name === 'AbortError') || signal?.aborted) {
        throw new Error('Upload cancelled');
      }
      if (attempt === 0) continue; // transient network failure — one retry
      throw e;
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error ?? `${label} upload failed (${response.status})`;
      if (response.status >= 500 && attempt === 0) continue; // transient server error — one retry
      throw new Error(msg);
    }
    return await response.json();
  }
  // Unreachable: both attempts either returned or threw.
  throw new Error(`${label} upload failed`);
}

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
};

type UploadOptions = {
  folder?: string;       // e.g. 'vee/avatars', 'vee/stories' — mapped to Telegram type
  transformation?: string; // ignored (Telegram serves originals; kept for interface compat)
  mimeHint?: string;     // 2026-10-18: explicit MIME (e.g. 'video/mp4') when URI has no extension
  /** 2026-10-19: AbortController signal — lets the caller cancel an in-flight upload. */
  signal?: AbortSignal;
};

/**
 * Map Cloudinary folder → Telegram media type.
 */
function folderToType(folder?: string): string {
  if (!folder) return 'chat';
  if (folder.includes('avatar')) return 'avatar';
  if (folder.includes('stories')) return 'story';
  if (folder.includes('dm')) return 'chat';
  if (folder.includes('rooms') || folder.includes('covers')) return 'avatar';
  return 'chat';
}

/**
 * Guess MIME type from URI extension.
 */
function guessMime(uri: string, fallback: string): string {
  const lower = uri.toLowerCase().split('?')[0];
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return fallback;
}

/**
 * Upload any file to the Vee media server (Telegram-backed).
 * @param localUri  - expo-image-picker result URI
 * @param options   - optional folder (mapped to Telegram type)
 */
export async function uploadImage(
  localUri: string,
  options: UploadOptions = {},
): Promise<CloudinaryUploadResult> {
  // 2026-10-19: fail fast on oversize files before spending bandwidth.
  await assertUploadSizeOk(localUri);
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error('Not authenticated — cannot upload media');
  }

  const type = folderToType(options.folder);
  // 2026-10-18: mimeHint (from picker asset.type) wins — gallery URIs often
  // lack extensions, and defaulting a video to image/jpeg breaks playback.
  const mime = options.mimeHint || guessMime(localUri, 'image/jpeg');
  const fileName = `upload_${Date.now()}.${mime.split('/')[1] || 'jpg'}`;

  const data = await postUpload(
    () => buildFormData(localUri, mime, fileName, type),
    idToken,
    options.signal,
    'Media',
  );

  const url = data.url as string;
  const mediaId = data.mediaId as string;
  if (!url || !mediaId) {
    throw new Error('Media upload returned no URL');
  }

  return {
    url,
    publicId: mediaId,
    width: 0,
    height: 0,
    format: mime.split('/')[1] || 'jpeg',
  };
}

/**
 * Profile photo upload.
 */
export async function uploadProfilePhoto(localUri: string): Promise<CloudinaryUploadResult> {
  return uploadImage(localUri, { folder: 'vee/avatars' });
}

/**
 * Story image upload.
 */
export async function uploadStoryImage(
  localUri: string,
  options: UploadOptions = {},
): Promise<CloudinaryUploadResult> {
  return uploadImage(localUri, { folder: 'vee/stories', ...options });
}

/**
 * Story video upload.
 * Throws with the actual cause on failure.
 */
export async function uploadStoryVideo(
  localUri: string,
  signal?: AbortSignal,
): Promise<CloudinaryUploadResult> {
  // 2026-10-19: gallery videos were uncapped — fail fast on oversize files.
  await assertUploadSizeOk(localUri);
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error('Not authenticated — cannot upload video story');
  }

  const mime = guessMime(localUri, 'video/mp4');
  const fileName = `story_${Date.now()}.mp4`;

  const data = await postUpload(
    () => buildFormData(localUri, mime, fileName, 'story'),
    idToken,
    signal,
    'Video',
  );

  const url = data.url as string;
  if (!url) throw new Error('Video upload returned no URL');
  return {
    url,
    publicId: data.mediaId as string,
    width: 0,
    height: 0,
    format: mime.split('/')[1] || 'mp4',
  };
}

/**
 * Story audio upload.
 * Throws with the actual cause on failure.
 */
export async function uploadStoryAudio(
  localUri: string,
  fileName?: string,
  mimeType?: string,
  signal?: AbortSignal,
): Promise<CloudinaryUploadResult> {
  // 2026-10-19: fail fast on oversize files before spending bandwidth.
  await assertUploadSizeOk(localUri);
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error('Not authenticated — cannot upload audio story');
  }

  const mime = mimeType || guessMime(localUri, 'audio/mpeg');
  const safeName = (fileName || `story_audio_${Date.now()}.mp3`).replace(/[^\w.\-]/g, '_');

  const data = await postUpload(
    () => buildFormData(localUri, mime, safeName, 'story'),
    idToken,
    signal,
    'Audio',
  );

  const url = data.url as string;
  if (!url) throw new Error('Audio upload returned no URL');
  return {
    url,
    publicId: data.mediaId as string,
    width: 0,
    height: 0,
    format: mime.split('/')[1] || 'mp3',
  };
}

/**
 * Room cover upload.
 */
export async function uploadRoomCover(localUri: string): Promise<CloudinaryUploadResult> {
  return uploadImage(localUri, { folder: 'vee/rooms' });
}

/**
 * Profile cover photo upload.
 */
export async function uploadCoverPhoto(localUri: string): Promise<CloudinaryUploadResult> {
  return uploadImage(localUri, { folder: 'vee/covers' });
}

/**
 * Delete a media asset.
 *
 * Telegram-backed storage is permanent — there is nothing to delete.
 * This is kept as a no-op for interface compatibility with existing callers
 * (app/profile/edit.tsx, app/profile/index.tsx).
 */
export async function deleteCloudinaryAsset(publicId: string): Promise<void> {
  // No-op: Telegram storage has no delete; old assets simply remain.
  return;
}
