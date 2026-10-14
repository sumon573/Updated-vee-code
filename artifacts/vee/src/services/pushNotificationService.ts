/**
 * Push Notification Service — OneSignal Client Integration
 *
 * BUG 13 fix: Detect Expo Go and skip native OneSignal initialization.
 * TurboModuleRegistry.getEnforcing('OneSignal') crashes in Expo Go because
 * the native module is not bundled there. We detect Expo Go via
 * expo-constants and short-circuit all OneSignal calls in that environment.
 * OneSignal is fully initialized only in EAS Development Builds and
 * production APK/IPA builds.
 *
 * isExpoGo() is now imported from src/utils/platform.ts (single source of
 * truth — previously duplicated here and in the voice-room engine hook).
 */

import { update, ref } from 'firebase/database';
import { database } from '../config/firebase';
import { isExpoGo } from '../utils/platform';

// ─── OneSignal SDK — lazy native require ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let OneSignal: any = null;

// 2026-10-13: Init-ready flag — loginOneSignal() waits for initializeOneSignal()
// to complete first (fixes race where login ran before initialize).
let initPromise: Promise<void> | null = null;
let initDone = false;

async function getOneSignal() {
  // BUG 13: Never attempt to load the native module in Expo Go
  if (isExpoGo()) return null;

  if (OneSignal) return OneSignal;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-onesignal');
    OneSignal = mod.default ?? mod.OneSignal ?? mod;
    return OneSignal;
  } catch {
    // EAS Dev Build ছাড়া native module পাওয়া যাবে না — graceful fallback
    return null;
  }
}

/** App start-এ একবার call করুন (app/_layout.tsx-এ) */
export async function initializeOneSignal(appId: string): Promise<void> {
  // BUG 13: Skip entirely in Expo Go
  if (isExpoGo()) return;

  // 2026-10-13: Dedupe + ready flag for login ordering
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const os = await getOneSignal();
    if (!os) {
      console.log('[OneSignal] Native module not available — skipping init');
      return;
    }
    try {
      os.initialize(appId);
      console.log('[OneSignal] initialize() done with appId:', appId);
      // Permission request (Android 13+)
      const granted = await os.Notifications.requestPermission(true);
      console.log('[OneSignal] Notification permission granted:', granted);
      if (!granted) {
        console.log('[OneSignal] WARNING: permission denied — pushes will NOT arrive until user enables in Settings');
      }
      initDone = true;
    } catch (e) {
      console.log('[OneSignal] initializeOneSignal error:', e);
    }
  })();
  return initPromise;
}

/** Initialize শেষ হওয়া পর্যন্ত wait করে (login-এর আগে call করুন) */
async function waitForInit(): Promise<void> {
  if (initDone) return;
  if (initPromise) {
    try { await initPromise; } catch { /* non-critical */ }
    // 2026-10-14 (Sumon): initPromise resolve হলেও initDone false থাকতে পারে —
    // poll করে initDone true হওয়া পর্যন্ত wait করি (max 10s)
    for (let i = 0; i < 20 && !initDone; i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!initDone) {
      console.log('[OneSignal] ⚠️ waitForInit: initDone still false after 10s — proceeding anyway');
    }
    return;
  }
  // initialize() কখনো call হয়নি — initDone true হওয়া পর্যন্ত poll করি (max 10s)
  // 2026-10-14 (Sumon): 2s fixed wait race condition ছিল — init শেষ না হতেই login হতো
  for (let i = 0; i < 20 && !initDone; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!initDone) {
    console.log('[OneSignal] ⚠️ waitForInit: initialize() never called, initDone false after 10s');
  }
}

/** User login/signup-এর পর call করুন — Firebase UID দিয়ে OneSignal-কে link করে */
export async function loginOneSignal(uid: string): Promise<void> {
  // BUG 13: Skip entirely in Expo Go
  if (isExpoGo()) return;

  // 2026-10-13: initialize() শেষ হওয়া পর্যন্ত wait (race condition fix)
  await waitForInit();

  const os = await getOneSignal();
  if (!os) {
    console.log('[OneSignal] Native module not available');
    return;
  }
  try {
    // External ID set করলে Cloud Function থেকে এই user-কে target করা যাবে
    // 2026-10-14 (Sumon): Verify login actually took effect — dashboard showed
    // 4/5 devices missing External User ID, causing silent notification failures.
    // Retry up to 3 times with verification.
    let loginVerified = false;
    for (let loginAttempt = 0; loginAttempt < 3 && !loginVerified; loginAttempt++) {
      try {
        await os.login(uid);
        // Verify: check if external ID was actually set
        await new Promise((r) => setTimeout(r, 2000));
        const externalId = (os as any)?.User?.externalId;
        if (externalId === uid) {
          loginVerified = true;
          console.log('[OneSignal] ✅ login() verified for uid:', uid);
        } else {
          console.log(`[OneSignal] ⚠️ login() attempt ${loginAttempt + 1}: externalId=${externalId}, expected=${uid} — retrying`);
        }
      } catch (loginErr) {
        console.log(`[OneSignal] ❌ login() attempt ${loginAttempt + 1} failed:`, loginErr);
      }
    }
    if (!loginVerified) {
      console.log('[OneSignal] ❌ CRITICAL: login() failed after 3 attempts — notifications will NOT work for this device');
    }

    // FIX 2026-10-13: Push subscription ID immediately after login() প্রায়ই
    // null থাকে — OneSignal server থেকে async-এ generate হয়। Retry loop দিয়ে
    // wait করি, তারপর Firebase-এ save করি।
    // 2026-10-13 (Sumon): Extended to 30s + permission check — root cause of
    // "no notifications" was pushSubscription.id never obtained.
    let subId: string | undefined;
    let permissionGranted = true;
    try {
      // Check notification permission status
      const permStatus = await os.Notifications?.permissionNative?.();
      console.log('[OneSignal] Permission status:', permStatus);
      if (permStatus === false || permStatus === 0) {
        permissionGranted = false;
        console.log('[OneSignal] ❌ NOTIFICATION PERMISSION DENIED — user must enable in Settings');
      }
    } catch {
      // Permission check not available on this SDK version — continue
    }
    
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        subId = os.User?.pushSubscription?.id ?? undefined;
      } catch {
        subId = undefined;
      }
      if (subId) break;
      if (attempt % 5 === 0) {
        console.log(`[OneSignal] waiting for pushSubscription.id (attempt ${attempt + 1}/30)`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (subId) {
      console.log('[OneSignal] ✅ Got pushSubscription.id, saving to Firebase');
      await saveOneSignalIdToFirebase(uid, subId);
    } else {
      console.log('[OneSignal] ❌ FAILED: pushSubscription.id null after 30s');
      if (!permissionGranted) {
        console.log('[OneSignal] CAUSE: Notification permission denied. Enable in Settings > Apps > Vee > Notifications');
      } else {
        console.log('[OneSignal] CAUSE UNKNOWN: Permission granted but no subscription ID. Possible OneSignal SDK/config issue.');
      }
    }

    // Subscription change listener — ID পরে generate হলে auto-save
    try {
      os.User?.pushSubscription?.addEventListener?.('change', async (event: unknown) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newId = (event as any)?.current?.id as string | undefined;
          if (newId) {
            console.log('[OneSignal] pushSubscription changed, new id — saving');
            await saveOneSignalIdToFirebase(uid, newId);
          }
        } catch {
          // non-critical
        }
      });
    } catch {
      // non-critical — older SDK may not support addEventListener
    }
  } catch (e) {
    console.log('[OneSignal] loginOneSignal error:', e);
  }
}

/** Logout-এর সময় call করুন */
export async function logoutOneSignal(): Promise<void> {
  // BUG 13: Skip entirely in Expo Go
  if (isExpoGo()) return;

  const os = await getOneSignal();
  if (!os) return;
  try {
    await os.logout();
  } catch {
    // silently ignore
  }
}

/**
 * Register a handler for when the user taps a (background/killed-state) push
 * notification.
 *
 * Routing:
 *   chatId present                         → onChat(chatId)   (open DM thread)
 *   type is 'room-invite' | 'seat-approved'
 *       | 'seat-invite' and roomId present → onRoom(roomId)   (open voice room)
 *   otherwise                              → onFallback()      (open Inbox list)
 *
 * RC8-B2: Added onRoom callback so seat-approved, room-invite, and seat-invite
 * push notifications navigate directly to the voice room instead of Inbox.
 * Never throws — any SDK/parsing error safely falls back to Inbox.
 * Call once on app start (app/_layout.tsx).
 */
export async function registerNotificationOpenedHandler(
  onChat: (chatId: string) => void,
  onRoom: (roomId: string) => void,
  onFallback: () => void,
  onCall?: (callerUid: string, callerName: string) => void,
): Promise<() => void> {
  // BUG 13: Skip entirely in Expo Go
  if (isExpoGo()) return () => {};

  const os = await getOneSignal();
  if (!os?.Notifications?.addEventListener) return () => {};

  const ROOM_NOTIFICATION_TYPES = new Set([
    'room-invite',
    'seat-approved',
    'seat-invite',
    'seat-rejected', // navigate to room so user sees the seat state
  ]);

  const handler = (event: unknown) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (event as any)?.notification?.additionalData as
        | Record<string, unknown>
        | undefined;
      const chatId = data?.chatId;
      const roomId = data?.roomId;
      const type   = data?.type;

      if (typeof type === 'string' && type === 'incoming-call' && onCall) {
        const callerUid = typeof data?.callerUid === 'string' ? data.callerUid : '';
        const callerName = typeof data?.callerName === 'string' ? data.callerName : 'Vee';
        if (callerUid) { onCall(callerUid, callerName); return; }
      }
      if (typeof chatId === 'string' && chatId.length > 0) {
        onChat(chatId);
      } else if (
        typeof type === 'string' &&
        ROOM_NOTIFICATION_TYPES.has(type) &&
        typeof roomId === 'string' &&
        roomId.length > 0
      ) {
        onRoom(roomId);
      } else {
        onFallback();
      }
    } catch {
      // Never crash on a malformed notification payload — go to Inbox.
      onFallback();
    }
  };

  try {
    os.Notifications.addEventListener('click', handler);
    return () => {
      try {
        os.Notifications.removeEventListener?.('click', handler);
      } catch {
        // non-critical
      }
    };
  } catch {
    return () => {};
  }
}

/** OneSignal subscription ID Firebase users/{uid}/oneSignalId-এ save করে */
async function saveOneSignalIdToFirebase(uid: string, oneSignalId: string): Promise<void> {
  try {
    // 2026-10-14 (Sumon): Direct path-এ set করি — users/{uid} parent-এ update
    // করলে parent-এর .validate rule (activeFrame check) trigger হয়ে block করতে পারে।
    // Direct child path-এ write করলে parent validate bypass হয়।
    const { set } = await import('firebase/database');
    await set(ref(database, `users/${uid}/oneSignalId`), oneSignalId);
    console.log('[OneSignal] ✅ oneSignalId saved to Firebase');
  } catch (e) {
    console.log('[OneSignal] ❌ Failed to save oneSignalId:', e);
  }
}
