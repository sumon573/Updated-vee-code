/**
 * NoiseGate — Premium Voice v2 (2026-10-22, Sumon).
 *
 * A conservative, Discord-style soft gate on the LOCAL mic: while the user
 * is not speaking, steady and burst background noise (fan surges, TV,
 * keyboard) that noise suppression alone misses is silenced completely;
 * the instant real speech starts, the gate opens.
 *
 * Safety design (boss's condition: users must NEVER be annoyed by it):
 * - The level signal is the CAPTURE-side `media-source` audioLevel from
 *   WebRTC stats, which keeps updating while the send track is gated —
 *   so speech onset is always visible (no gate deadlock).
 * - If that signal is missing, frozen, or vanishes mid-gate, the gate
 *   disables itself for the session instead of guessing.
 * - It closes only after ~900ms of CONTINUOUS quiet below a threshold
 *   calibrated from the room's own noise floor (never while the
 *   platform reports the user as speaking), opens on a single poll
 *   above a higher threshold (hysteresis), and force-reopens after a
 *   bounded max closed time.
 * - The gate only flips the raw MediaStreamTrack's `enabled` flag. It
 *   never touches the app's mute state, so mic icons/UI never flicker.
 */

export interface NoiseGateIO {
  /** Capture-side mic level 0..1, or null when unavailable. */
  readLevel: () => Promise<number | null>;
  /** Enable/disable the raw mic track's sending. */
  setTrackEnabled: (enabled: boolean) => void;
  /** User's own mute (app-level) — while true the gate touches nothing. */
  isUserMuted: () => boolean;
  /** Platform speaking flag (extra speech guard), when available. */
  isSpeaking?: () => boolean;
}

/** Pull the capture-side audioLevel out of an RTCStatsReport of any shape
 *  (Map-like in the RN WebRTC fork, plain objects in some builds). */
export function extractMediaSourceLevel(report: unknown): number | null {
  let level: number | null = null;
  const visit = (s: unknown) => {
    const stat = s as { type?: string; audioLevel?: unknown } | null;
    if (stat && stat.type === 'media-source' && typeof stat.audioLevel === 'number') {
      level = stat.audioLevel;
    }
  };
  try {
    const r = report as {
      forEach?: (cb: (s: unknown) => void) => void;
      values?: () => Iterable<unknown>;
    } | null;
    if (!r) return null;
    if (typeof r.forEach === 'function') r.forEach(visit);
    else if (typeof r.values === 'function') { for (const s of r.values()) visit(s); }
    else if (Array.isArray(r)) r.forEach(visit);
    else if (typeof r === 'object') Object.values(r as Record<string, unknown>).forEach(visit);
  } catch {
    /* stats shape surprises are non-fatal — gate just disables itself */
  }
  return level;
}

const POLL_MS = 250;
const CLOSE_AFTER_MS = 900;
const MAX_CLOSED_MS = 25000;
const MISS_LIMIT_BEFORE_EVER_CLOSING = 40; // ~10s of no signal at start
const MISS_LIMIT_WHILE_CLOSED = 4;

export class NoiseGate {
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private quietSince = 0;
  private closedAt = 0;
  private misses = 0;
  private disabled = false;
  private lastLevel: number | null = null;
  private identicalStreak = 0;
  private floorSamples: number[] = [];

  constructor(private io: NoiseGateIO) {}

  start(): void {
    this.stopTimer();
    this.closed = false;
    this.quietSince = 0;
    this.misses = 0;
    this.disabled = false;
    this.lastLevel = null;
    this.identicalStreak = 0;
    this.floorSamples = [];
    this.timer = setInterval(() => { void this.tick(); }, POLL_MS);
  }

  stop(): void {
    this.stopTimer();
    if (this.closed) {
      this.closed = false;
      // Restore the track unless the user's own mute owns it now.
      if (!this.io.isUserMuted()) {
        try { this.io.setTrackEnabled(true); } catch { /* non-critical */ }
      }
    }
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private floor(): number {
    if (this.floorSamples.length < 8) return 0.004;
    const sorted = [...this.floorSamples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.75)] ?? 0.004;
  }

  private closeThreshold(): number {
    return Math.min(0.055, Math.max(0.01, this.floor() * 2.5 + 0.002));
  }

  private async tick(): Promise<void> {
    if (this.disabled) return;
    // The user's own mute owns the track — the gate steps aside entirely
    // and forgets it ever closed (mute already set the track state).
    if (this.io.isUserMuted()) {
      this.closed = false;
      this.quietSince = 0;
      return;
    }

    let level: number | null = null;
    try { level = await this.io.readLevel(); } catch { level = null; }

    if (level == null) {
      this.misses += 1;
      if (this.closed && this.misses >= MISS_LIMIT_WHILE_CLOSED) {
        // Signal lost mid-gate — reopen and retire the gate this session.
        try { this.io.setTrackEnabled(true); } catch { /* non-critical */ }
        this.closed = false;
        this.disabled = true;
      } else if (!this.closed && this.misses >= MISS_LIMIT_BEFORE_EVER_CLOSING) {
        this.disabled = true;
      }
      return;
    }
    this.misses = 0;

    // Frozen-stat detector (only meaningful on real signal): a bit-identical
    // non-zero level for 5s straight is a broken stats source, not audio.
    if (this.lastLevel !== null && level === this.lastLevel && level > 0.02) {
      this.identicalStreak += 1;
      if (this.identicalStreak >= 20 && !this.closed) { this.disabled = true; return; }
    } else {
      this.identicalStreak = 0;
    }
    this.lastLevel = level;

    const speaking = this.io.isSpeaking?.() ?? false;
    const closeTh = this.closeThreshold();
    const openTh = closeTh * 1.7;
    const now = Date.now();

    if (this.closed) {
      if (speaking || level > openTh || now - this.closedAt >= MAX_CLOSED_MS) {
        try { this.io.setTrackEnabled(true); } catch { /* non-critical */ }
        this.closed = false;
        this.quietSince = 0;
      }
      return;
    }

    // OPEN state: learn the noise floor from quiet, non-speaking samples.
    if (!speaking && level < 0.08) {
      this.floorSamples.push(level);
      if (this.floorSamples.length > 48) this.floorSamples.shift();
    }

    if (!speaking && level < closeTh) {
      if (this.quietSince === 0) this.quietSince = now;
      if (now - this.quietSince >= CLOSE_AFTER_MS) {
        try { this.io.setTrackEnabled(false); } catch { /* non-critical */ }
        this.closed = true;
        this.closedAt = now;
        this.quietSince = 0;
      }
    } else {
      this.quietSince = 0;
    }
  }
}
