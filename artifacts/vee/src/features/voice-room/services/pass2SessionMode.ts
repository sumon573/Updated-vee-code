/**
 * Pass2 session-mode choreography (another-pass Phase 1, staging build).
 *
 * DESIGN.md §3.8: entering a converted mode means, in order:
 *   1. Unsubscribe every Firebase listener the session holds in that mode
 *      (callers register each unsub here so teardown is exhaustive, not
 *      hopeful — React effect cleanups still run first when a mode flag
 *      flips, and this registry is the second net for subscriptions held
 *      outside effects, e.g. the network banner).
 *   2. Cancel onDisconnect handlers registered in that mode
 *      (onDisconnect(ref).cancel() — the API seat cleanup already uses).
 *      This matters: an onDisconnect presence write firing on goOffline()
 *      would mark a live poll-mode user offline in Firebase.
 *   3. Call goOffline(). From here the session holds 0 RTDB slots.
 *   4. All reads go through REST/poller; all writes go through REST.
 *      No SDK call of any kind in the mode — including one-shot get()
 *      (it reopens the socket).
 * On leaving the mode (or on fallback): goOnline() and resubscribe
 * today's Firebase path — but ONLY when no other pass2 mode is still
 * active, so one mode's exit never reopens the socket for another mode.
 *
 * SEATED LIMIT (this build): goOffline() runs only for AUDIENCE pass2
 * room sessions. A seated session's seat actions (take/leave/mute) still
 * go through the Firebase SDK in this build (§3.9 write routing for seat
 * actions is deferred — see pass2RestService.roomAction, which is built
 * but not yet wired to the seat call sites), so taking goOffline() while
 * seated would queue seat writes locally instead of applying them.
 * Seated pass2 sessions therefore enter the registry WITHOUT goOffline:
 * their reads move to polls, their heartbeat moves to the poller beat
 * (beat seatIdx, §3.3), and the socket stays until seat-action routing
 * lands. The `offline` flag on enterPass2Mode records which case applies.
 *
 * INERT IN PRODUCTION: nothing here runs unless a screen's pass2 flag
 * (fetchPass2Flags, fail-closed false) turns its mode on. With all flags
 * off, no mode ever enters and goOffline()/goOnline() are never called.
 */
import { goOffline, goOnline, onDisconnect, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';

export type Pass2Mode = 'room' | 'home' | 'profile' | 'dm';

type ModeState = {
  /** True when this mode entered AND requested goOffline (audience only). */
  offline: boolean;
  unsubs: Array<() => void>;
  disconnectPaths: string[];
};

const modes = new Map<Pass2Mode, ModeState>();

/** Seated poll-mode flag: true while a pass2 room session holds a seat. */
let pass2Seated = false;
export function setPass2Seated(seated: boolean): void {
  pass2Seated = seated;
}
export function isPass2Seated(): boolean {
  return pass2Seated;
}

/** Register an unsub so mode teardown is exhaustive. */
export function registerPass2Unsub(mode: Pass2Mode, unsub: () => void): void {
  let st = modes.get(mode);
  if (!st) {
    st = { offline: false, unsubs: [], disconnectPaths: [] };
    modes.set(mode, st);
  }
  st.unsubs.push(unsub);
}

/** Register an onDisconnect path so teardown can cancel it. */
export function registerPass2Disconnect(mode: Pass2Mode, path: string): void {
  let st = modes.get(mode);
  if (!st) {
    st = { offline: false, unsubs: [], disconnectPaths: [] };
    modes.set(mode, st);
  }
  if (!st.disconnectPaths.includes(path)) st.disconnectPaths.push(path);
}

export function isPass2ModeActive(mode: Pass2Mode): boolean {
  return modes.has(mode);
}

export function isAnyPass2ModeActive(): boolean {
  return modes.size > 0;
}

function anyModeOffline(): boolean {
  for (const st of modes.values()) if (st.offline) return true;
  return false;
}

/**
 * Enter a converted mode. Steps 1–3 of §3.8: run registered unsubs,
 * cancel registered onDisconnect handlers, then goOffline() — but only
 * when opts.offline is true (audience room sessions; see SEATED LIMIT).
 * Callers must already have torn down their effect subscriptions (the
 * mode flag flip runs React cleanups first); this is the second net.
 */
export function enterPass2Mode(mode: Pass2Mode, opts?: { offline?: boolean }): void {
  const offline = opts?.offline === true;
  let st = modes.get(mode);
  if (!st) {
    st = { offline: false, unsubs: [], disconnectPaths: [] };
    modes.set(mode, st);
  }
  for (const u of st.unsubs) {
    try { u(); } catch { /* noop */ }
  }
  st.unsubs = [];
  for (const path of st.disconnectPaths) {
    try {
      void onDisconnect(ref(database, path)).cancel();
    } catch { /* noop */ }
  }
  st.disconnectPaths = [];
  st.offline = offline;
  if (offline) {
    try { goOffline(database); } catch { /* noop */ }
  }
}

/**
 * Leave a converted mode. Runs the mode's registered unsubs, then
 * goOnline() ONLY when no remaining active mode requested offline.
 * Fallback (§3.10) uses this: the screen flips its mode flag off, its
 * effect cleanup calls exitPass2Mode, and today's Firebase path
 * resubscribes on the next render.
 */
export function exitPass2Mode(mode: Pass2Mode): void {
  const st = modes.get(mode);
  if (st) {
    for (const u of st.unsubs) {
      try { u(); } catch { /* noop */ }
    }
    modes.delete(mode);
  }
  if (!anyModeOffline()) {
    try { goOnline(database); } catch { /* noop */ }
  }
}

// ─── Transport health (feeds the HTTP-probe network derivation) ────────────
// pass2 REST/poller calls report success/failure here. networkService's
// probe derivation reads the recency of the last failure: probe OK +
// recent transport failure = 'reconnecting'; probe OK + no recent failure
// = 'connected'; probe fail = 'offline'. A failure older than 60s stops
// counting — a single blip must not pin the banner on 'reconnecting'.
let lastTransportFailureAt = 0;
let lastTransportSuccessAt = 0;

export function reportPass2TransportSuccess(): void {
  lastTransportSuccessAt = Date.now();
}

export function reportPass2TransportFailure(): void {
  lastTransportFailureAt = Date.now();
}

export function pass2TransportFailedRecently(windowMs = 60_000): boolean {
  return (
    lastTransportFailureAt > 0 &&
    Date.now() - lastTransportFailureAt < windowMs &&
    lastTransportFailureAt >= lastTransportSuccessAt
  );
}
