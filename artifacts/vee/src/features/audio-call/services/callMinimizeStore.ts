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
