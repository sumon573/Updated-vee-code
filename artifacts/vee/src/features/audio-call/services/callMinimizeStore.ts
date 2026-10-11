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
