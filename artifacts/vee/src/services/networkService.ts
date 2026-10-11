/**
 * Network connectivity service (NOTE 5, 2026-10-11).
 *
 * Primary signal: Firebase RTDB `.info/connected` — the real socket state,
 * no extra dependency needed. When the socket drops we run a lightweight
 * HTTP check to distinguish "no internet" from "Firebase reconnecting".
 *
 * States:
 *  - 'connected'     → socket live
 *  - 'reconnecting'  → internet works, Firebase socket down
 *  - 'offline'       → no internet at all
 */
import { ref, onValue } from 'firebase/database';
import { database } from '../config/firebase';

export type NetworkState = 'connected' | 'reconnecting' | 'offline';

const PROBE_URL = 'https://www.google.com/generate_204';
const PROBE_TIMEOUT_MS = 5000;
const RECHECK_INTERVAL_MS = 15000;

async function hasInternet(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const init: RequestInit = {
      method: 'HEAD',
      signal: ctrl.signal,
      // 'no-store' keeps the probe from returning a cached response.
      cache: 'no-store',
    };
    const res = await fetch(PROBE_URL, init);
    clearTimeout(timer);
    return res.status === 204 || res.ok;
  } catch {
    return false;
  }
}

export function subscribeNetworkStatus(
  callback: (state: NetworkState) => void,
): () => void {
  let disposed = false;
  let recheckTimer: ReturnType<typeof setInterval> | null = null;
  let lastState: NetworkState | null = null;
  // Generation counter — stale async probes from a previous disconnect
  // must never overwrite a newer state.
  let generation = 0;

  const emit = (s: NetworkState) => {
    if (disposed || s === lastState) return;
    lastState = s;
    callback(s);
  };

  const stopRecheck = () => {
    if (recheckTimer) {
      clearInterval(recheckTimer);
      recheckTimer = null;
    }
  };

  /** While the socket is down, periodically re-probe to pick the right label. */
  const startRecheck = () => {
    stopRecheck();
    recheckTimer = setInterval(async () => {
      if (disposed) return;
      const online = await hasInternet();
      if (disposed) return;
      emit(online ? 'reconnecting' : 'offline');
    }, RECHECK_INTERVAL_MS);
  };

  const connectedRef = ref(database, '.info/connected');
  const unsub = onValue(
    connectedRef,
    (snap) => {
      if (disposed) return;
      const socketLive = snap.val() === true;
      if (socketLive) {
        generation += 1;
        stopRecheck();
        emit('connected');
      } else {
        // Socket down — determine whether it's the internet or just Firebase.
        const myGen = ++generation;
        hasInternet().then((online) => {
          if (disposed || myGen !== generation) return;
          emit(online ? 'reconnecting' : 'offline');
          startRecheck();
        });
      }
    },
    () => {
      // Listener error (e.g. permission) — fall back to the HTTP probe.
      const myGen = ++generation;
      hasInternet().then((online) => {
        if (!disposed && myGen === generation) emit(online ? 'reconnecting' : 'offline');
      });
    },
  );

  return () => {
    disposed = true;
    generation += 1;
    stopRecheck();
    unsub();
  };
}

/** One-shot connectivity check (for pull-to-refresh style call sites). */
export async function checkConnectivity(): Promise<NetworkState> {
  const online = await hasInternet();
  return online ? 'connected' : 'offline';
}
