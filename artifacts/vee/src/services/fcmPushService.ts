/**
 * 2026-10-14 (Sumon): Permanent unlimited push via FCM Direct + expo-notifications.
 * 
 * ARCHITECTURE (no-risk, unlimited, free):
 * - VPS sends FCM direct to the device's FCM token (unlimited, $0)
 * - App gets FCM token via expo-notifications (official Expo plugin, no third-party risk)
 * - expo-notifications displays in FOREGROUND + BACKGROUND + KILLED
 * - Token saved to users/{uid}/fcmToken (VPS reads from here)
 * 
 * This replaces OneSignal for push delivery. OneSignal SDK can stay for now
 * (or be removed later) — it is not used for receiving.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { ref, set } from 'firebase/database';
import { database } from '../config/firebase';

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
    console.log('[FCM] ✅ Token saved to Firebase');
    return fcmToken;
  } catch (e) {
    console.log('[FCM] registerFcmToken error:', e);
    return null;
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
    await Notifications.setNotificationChannelAsync('vee_notifications', {
      name: 'Vee Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED',
    });
    console.log('[FCM] Android channel ready');
  } catch (e) {
    console.log('[FCM] Channel setup error:', e);
  }
}
