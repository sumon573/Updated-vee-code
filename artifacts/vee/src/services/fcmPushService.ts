/**
 * 2026-10-14 (Sumon): Permanent unlimited push via FCM Direct + expo-notifications.
 * 
 * ARCHITECTURE (no-risk, unlimited, free):
 * - VPS sends FCM direct to the device's FCM token (unlimited, $0)
 * - App gets FCM token via expo-notifications (official Expo plugin, no third-party risk)
 * - expo-notifications displays in FOREGROUND + BACKGROUND + KILLED
 * - Token saved per-device to users/{uid}/fcmTokens/{deviceId} (2026-10-19:
 *   a scalar fcmToken meant a second device's login clobbered the first
 *   device's token). The legacy users/{uid}/fcmToken is still written for
 *   backward compat with the current server; per-device node removed on logout.
 * 
 * This replaces OneSignal for push delivery. OneSignal SDK can stay for now
 * (or be removed later) — it is not used for receiving.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, set, remove } from 'firebase/database';
import { database } from '../config/firebase';

/** AsyncStorage key for the stable per-device push ID (pure JS — no native module). */
const FCM_DEVICE_ID_KEY = 'vee_fcm_device_id';

/**
 * Stable per-device ID used as the key under users/{uid}/fcmTokens/.
 * Generated once and persisted in AsyncStorage (no native module needed).
 */
async function getOrCreateDeviceId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(FCM_DEVICE_ID_KEY);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      await AsyncStorage.setItem(FCM_DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'dev_unknown';
  }
}

let handlerSet = false;

/**
 * Set up notification handler. Call once at app startup (after native modules ready).
 * MUST NOT run at import time — causes startup crash.
 */
export function setupNotificationHandler() {
  if (handlerSet) return;
  handlerSet = true;
  // Show notifications even when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Fix #35 (2026-10-29): dismiss one chat's system-bar notifications the
 * moment its messages are seen. Presented notifications are matched by
 * their push payload's data.chatId — the same key the tap handler routes
 * on (app/_layout.tsx) — so ONLY that chat's notifications go away:
 * call pushes carry no chatId and other chats' notifications are
 * untouched. Same mechanism as dismissIncomingCallNotifications (which
 * matches data.type); FCM exposes no stable tag to expo-notifications.
 * Best-effort: a stale bar entry is cosmetic, never fatal.
 */
export async function dismissChatNotifications(chatId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      const data = (n.request?.content?.data ?? {}) as Record<string, unknown>;
      if (data?.chatId === chatId) {
        await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
      }
    }
  } catch {
    /* best-effort — a stale tray entry is cosmetic */
  }
}

/**
 * 2026-10-19 (batch 2D): clear the app icon badge. setupNotificationHandler
 * sets shouldSetBadge:true so every push increments the badge, but nothing
 * ever cleared it — a stale count stuck forever. Call on app foreground and
 * on chat-list focus (user has seen the conversations).
 */
export async function clearAppBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // non-critical — badge may be unsupported on this platform
  }
}

/**
 * Register for push and save FCM token to Firebase.
 * Call after user login. Safe to call multiple times.
 */
export async function registerFcmToken(uid: string): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log('[FCM] Not a physical device — skipping push registration');
      return null;
    }

    // Request permission (Android 13+)
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[FCM] Permission denied — pushes will NOT arrive');
      return null;
    }

    // Get the native device push token (FCM token on Android)
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    // On Android, type is 'fcm' and data is the FCM registration token
    const fcmToken = (deviceToken as any)?.data as string | undefined;
    
    if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.length < 10) {
      console.log('[FCM] No valid FCM token received');
      return null;
    }

    // Save DIRECT to users/{uid}/fcmToken (child path, no parent update)
    await set(ref(database, `users/${uid}/fcmToken`), fcmToken);
    // Also mirror to oneSignalId for VPS backward-compat (VPS checks both)
    await set(ref(database, `users/${uid}/oneSignalId`), fcmToken);
    // 2026-10-19 (batch 2D): per-device token node — multi-device pushes.
    // The scalar fcmToken above is kept for backward compat with the current
    // server; devices are distinguished by the fcmTokens/{deviceId} map so
    // one device's login never clobbers another's. (Server-side multicast of
    // all tokens in this map is a separate VPS task — client only.)
    try {
      const deviceId = await getOrCreateDeviceId();
      await set(ref(database, `users/${uid}/fcmTokens/${deviceId}`), fcmToken);
    } catch {
      // non-critical — legacy scalar token already saved above
    }
    console.log('[FCM] ✅ Token saved to Firebase');
    return fcmToken;
  } catch (e) {
    console.log('[FCM] registerFcmToken error:', e);
    return null;
  }
}

/**
 * 2026-10-19 (batch 2D): remove THIS device's token on logout so a logged-out
 * device stops receiving the user's pushes. Must run BEFORE sign-out (rules
 * require auth). The legacy scalar fcmToken is left untouched — it is
 * overwritten by the next login on this or any device.
 */
export async function unregisterFcmToken(uid: string): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    await remove(ref(database, `users/${uid}/fcmTokens/${deviceId}`));
    console.log('[FCM] device token removed on logout');
  } catch {
    // non-critical — stale token entry is harmless
  }
}

/**
 * Set up listeners for notification received + tapped.
 * Call once at app startup (after login).
 * onTap receives the notification data payload (e.g. { chatId, category }).
 */
export function setupNotificationListeners(onTap: (data: Record<string, any>) => void): () => void {
  // Foreground: notification received while app is open
  const receivedSub = Notifications.addNotificationReceivedListener((notification: any) => {
    console.log('[FCM] Notification received in foreground:', notification.request.content.title);
    // The handler above (setNotificationHandler) already displays it
  });

  // User tapped the notification (from any app state)
  const responseSub = Notifications.addNotificationResponseReceivedListener((response: any) => {
    try {
      const data = response.notification.request.content.data as Record<string, any>;
      console.log('[FCM] Notification tapped:', JSON.stringify(data).slice(0, 200));
      onTap(data || {});
    } catch (e) {
      console.log('[FCM] Tap handler error:', e);
    }
  });

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}

/**
 * Create the Android notification channel (required for Android 8+).
 * Call once at app startup.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // 2026-10-20 (boss): ALL notifications use ONE unique sound — the bundled
    // notification_pop.wav (copied to res/raw by the expo-notifications plugin
    // config in app.json). Android channel settings are immutable after first
    // creation, so the sound ships on a NEW channel id (v2); the VPS sender
    // targets this same id. The old 'vee_notifications' channel is abandoned.
    await Notifications.setNotificationChannelAsync('vee_notifications_v2', {
      name: 'Vee Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED',
      sound: 'notification_pop.wav',
    });
    // 2026-10-23 (Sumon: incoming calls must arrive fast and be
    // unmissable): a DEDICATED calls channel at MAX importance with
    // public lock-screen visibility — the VPS sender targets
    // 'vee_calls_v1' for type 'incoming-call' pushes only. MAX makes
    // the call banner peek over other apps like a real call.
    await Notifications.setNotificationChannelAsync('vee_calls_v1', {
      name: 'Incoming Calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400, 200, 400],
      lightColor: '#22C55E',
      sound: 'notification_pop.wav',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    console.log('[FCM] Android channel ready');
  } catch (e) {
    console.log('[FCM] Channel setup error:', e);
  }
}
