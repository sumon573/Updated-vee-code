/* ─────────────────────── Music formatting ─────────────────────── */

/** Strip a file extension for display ("song.mp3" -> "song"). */
export function displayTitle(title: string): string {
  return title.replace(/\.[^.]+$/, '');
}

/** Seconds -> "00:00" / "04:54" (two-digit minutes, as in the reference). */
export function fmtDur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Bytes -> "950.6 KB" / "4.5 MB" (1 decimal, matching the reference rows). */
export function fmtSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "duration · size" line for a song row; size omitted when unknown. */
export function fmtRowMeta(durationSec: number | null | undefined, size: number | null | undefined): string {
  const sizeStr = fmtSize(size);
  return sizeStr ? `${fmtDur(durationSec)}  ${sizeStr}` : fmtDur(durationSec);
}
