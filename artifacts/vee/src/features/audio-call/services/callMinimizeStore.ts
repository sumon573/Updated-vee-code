/**
 * Call minimize store (2026-10-10).
 * Tiny pub/sub store for IMO-style minimized calls. When the user presses
 * back during a call, the call continues in the background and a floating
 * "Calling" badge with live duration shows on all screens.
 */

export interface MinimizedCall {
  remoteName: string;
  remotePhotoURL?: string | null;
  startedAt: number; // timestamp when call connected
  callId: string;
  // Navigation params to return to the call
  params: {
    roomId: string;
    role: string;
    calleeUid?: string;
    remoteUid?: string;
    remoteName?: string;
    // 2026-10-13: DP survives the minimize → return cycle so the returned
    // screen shows it instantly instead of refetching from Firebase.
    remotePhotoURL?: string;
    // 2026-10-11 fix: myUid/myName must survive the minimize → return cycle,
    // otherwise the returned screen can't do mute-sync, call history, etc.
    myUid?: string;
    myName?: string;
  };
}

type Listener = (call: MinimizedCall | null) => void;

let current: MinimizedCall | null = null;
const listeners = new Set<Listener>();

export function setMinimizedCall(call: MinimizedCall | null) {
  current = call;
  listeners.forEach((l) => l(current));
}

export function getMinimizedCall(): MinimizedCall | null {
  return current;
}

export function subscribeMinimizedCall(listener: Listener): () => void {
  listeners.add(listener);
  // Immediately notify with current value
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

// ─── WebRTC session persistence (2026-10-11 Issue #8) ───────────────────────
// When a call is minimized, the WebRTC session is stored here at module level
// (like voice rooms persist the LiveKit engine) so audio continues after the
// AudioCallScreen unmounts. Returning to the call reattaches to this session
// instead of creating a new peer connection.

let _persistedSession: unknown = null;
let _persistedRoomId: string | null = null;

export function setPersistedCallSession(roomId: string, session: unknown): void {
  _persistedSession = session;
  _persistedRoomId = roomId;
}

export function getPersistedCallSession(roomId: string): unknown | null {
  if (_persistedRoomId !== roomId) return null;
  return _persistedSession;
}

export function clearPersistedCallSession(): void {
  _persistedSession = null;
  _persistedRoomId = null;
}

// ─── Store-level teardown for a minimized call (2026-10-19, Sumon) ──────────
// A minimized call outlives its AudioCallScreen: session callbacks (e.g.
// remote hangup) fire on an UNMOUNTED instance's closures. Running `endCall`
// there risks touching dead refs/native objects from the wrong owner. So the
// WebRTC teardown for a persisted session lives HERE, in the store/session
// layer — the dead instance never performs the native hangup itself.
export function teardownPersistedCall(roomId: string): void {
  if (_persistedRoomId !== roomId) return;
  const session = _persistedSession as { hangup?: () => void } | null;
  _persistedSession = null;
  _persistedRoomId = null;
  if (session && typeof session.hangup === 'function') {
    try {
      session.hangup();
    } catch {
      /* non-critical — peer already gone */
    }
  }
  setMinimizedCall(null);
}

// ─── Minimize intent flag (2026-10-11 fix) ───────────────────────────────────
// Module-level flag set BEFORE navigating away, so every cleanup path
// (unmount, timers, remote-ended) can tell "minimizing" apart from "ending"
// even after the component's refs are gone. This fixes the race where
// React Navigation's own back handler dismissed the modal before our
// BackHandler ran — the screen unmounted without minimizeCall, and the
// cleanup ended the call.
let _isMinimizing = false;

export function setCallMinimizing(v: boolean): void {
  _isMinimizing = v;
}

export function isCallMinimizing(): boolean {
  return _isMinimizing;
}

// ─── Call screen mount tracking (2026-10-11 fix) ─────────────────────────────
// endCall(goBack=true) must only navigate when the call screen is actually
// mounted. Otherwise (e.g. remote hangup while minimized) router.back()
// would pop whatever screen the user is on.
let _callScreenMounted = false;

export function setCallScreenMounted(v: boolean): void {
  _callScreenMounted = v;
}

export function isCallScreenMounted(): boolean {
  return _callScreenMounted;
}
