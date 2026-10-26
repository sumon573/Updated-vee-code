/**
 * voiceCacheService — opportunistic local cache for DM voice notes
 * (weak-network Phase 2). The cache is NEVER data: any miss, failure or
 * eviction just falls back to remote streaming, exactly as before.
 *
 * Design: first play streams remote (unchanged) and downloads in the
 * background; replays swap the player to the local file (instant and
 * offline-proof). Local files live in the app cache dir, so the OS may
 * purge them under storage pressure — that only costs a re-download.
 */
import { File, Directory, Paths } from 'expo-file-system';

const PREFIX = 'vee_voice_';
const MAX_FILES = 200;

function hashUri(uri: string): string {
  let h = 0;
  for (let i = 0; i < uri.length; i++) h = (h * 31 + uri.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function extFor(remoteUri: string): string {
  const seg = remoteUri.split('?')[0].split('/').pop() || '';
  const dot = seg.lastIndexOf('.');
  if (dot > 0 && dot < seg.length - 1) {
    const c = seg.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['m4a', 'mp3', 'wav', 'ogg', 'webm'].includes(c)) return c;
    if (c === 'mp4') return 'm4a';
  }
  return 'm4a';
}

function cacheFileFor(remoteUri: string): File {
  return new File(Paths.cache, `${PREFIX}${hashUri(remoteUri)}.${extFor(remoteUri)}`);
}

/** Local cached URI if this voice note was downloaded before, else null. Never throws. */
export async function getCachedVoiceUri(remoteUri: string): Promise<string | null> {
  try {
    if (!/^https?:\/\//i.test(remoteUri)) return null;
    const f = cacheFileFor(remoteUri);
    return f.exists ? f.uri : null;
  } catch { return null; }
}

/** Downloads the voice note into the cache (fire-and-forget safe). Never throws. */
export async function cacheVoiceInBackground(remoteUri: string): Promise<void> {
  try {
    if (!/^https?:\/\//i.test(remoteUri)) return;
    const dest = cacheFileFor(remoteUri);
    if (dest.exists) return;
    const downloaded = await File.downloadFileAsync(remoteUri, dest);
    if (!downloaded.exists) return;
    // Opportunistic prune: evicted files just re-download next time.
    try {
      const entries = new Directory(Paths.cache).list();
      const ours = entries.filter((e): e is File => e instanceof File && e.name.startsWith(PREFIX));
      if (ours.length > MAX_FILES) {
        const excess = ours.filter((f) => f.name !== dest.name).slice(0, ours.length - MAX_FILES);
        excess.forEach((f) => { try { f.delete(); } catch { /* best-effort */ } });
      }
    } catch { /* prune is best-effort */ }
  } catch { /* cache is opportunistic; remote streaming still works */ }
}
