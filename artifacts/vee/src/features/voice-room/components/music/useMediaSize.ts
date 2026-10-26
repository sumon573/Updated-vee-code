/* ─────────────────────── Media size lookup ─────────────────────── */

import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system';

/**
 * useMediaSize — file size for a song row, session-cached.
 * Phone files: FileSystem.getInfoAsync (local, exact).
 * Library URLs: HTTP HEAD Content-Length (the media server answers it;
 * a missing header or failed HEAD just means "size unknown" — the row
 * then shows duration only, never a guessed size).
 * Null = loading OR unknown; rows render duration-only in both cases.
 */

const sizeCache = new Map<string, number | null>();

async function fetchSize(kind: 'file' | 'url', ref: string): Promise<number | null> {
  try {
    if (kind === 'file') {
      const info = await FileSystem.getInfoAsync(ref);
      if (info.exists && typeof (info as { size?: unknown }).size === 'number') {
        return (info as { size: number }).size;
      }
      return null;
    }
    const res = await fetch(ref, { method: 'HEAD' });
    const len = res.headers.get('content-length');
    const n = len ? parseInt(len, 10) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function useMediaSize(kind: 'file' | 'url', ref: string | null): number | null {
  const [size, setSize] = useState<number | null>(() =>
    ref ? (sizeCache.has(`${kind}:${ref}`) ? (sizeCache.get(`${kind}:${ref}`) ?? null) : null) : null,
  );
  useEffect(() => {
    if (!ref) {
      setSize(null);
      return;
    }
    const key = `${kind}:${ref}`;
    if (sizeCache.has(key)) {
      setSize(sizeCache.get(key) ?? null);
      return;
    }
    let alive = true;
    fetchSize(kind, ref).then((v) => {
      sizeCache.set(key, v);
      if (alive) setSize(v);
    });
    return () => {
      alive = false;
    };
  }, [kind, ref]);
  return size;
}
