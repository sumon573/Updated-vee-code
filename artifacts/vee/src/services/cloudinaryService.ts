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

const MEDIA_BASE = 'https://vee-club.duckdns.org';

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
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error('Not authenticated — cannot upload media');
  }

  const type = folderToType(options.folder);
  const mime = guessMime(localUri, 'image/jpeg');

  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: mime,
    name: `upload_${Date.now()}.${mime.split('/')[1] || 'jpg'}`,
  } as unknown as Blob);
  formData.append('type', type);

  const response = await fetch(`${MEDIA_BASE}/api/media/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error ?? `Media upload failed (${response.status})`);
  }

  const data = await response.json();
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
export async function uploadStoryImage(localUri: string): Promise<CloudinaryUploadResult> {
  return uploadImage(localUri, { folder: 'vee/stories' });
}

/**
 * Story video upload.
 * Throws with the actual cause on failure.
 */
export async function uploadStoryVideo(localUri: string): Promise<CloudinaryUploadResult> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error('Not authenticated — cannot upload video story');
  }

  const mime = guessMime(localUri, 'video/mp4');
  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: mime,
    name: `story_${Date.now()}.mp4`,
  } as unknown as Blob);
  formData.append('type', 'story');

  const response = await fetch(`${MEDIA_BASE}/api/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error ?? `Video upload failed (${response.status})`);
  }

  const data = await response.json();
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
): Promise<CloudinaryUploadResult> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) {
    throw new Error('Not authenticated — cannot upload audio story');
  }

  const mime = mimeType || guessMime(localUri, 'audio/mpeg');
  const safeName = (fileName || `story_audio_${Date.now()}.mp3`).replace(/[^\w.\-]/g, '_');

  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: mime,
    name: safeName,
  } as unknown as Blob);
  formData.append('type', 'story');

  const response = await fetch(`${MEDIA_BASE}/api/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error ?? `Audio upload failed (${response.status})`);
  }

  const data = await response.json();
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
