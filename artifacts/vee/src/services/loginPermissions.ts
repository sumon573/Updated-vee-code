/**
 * loginPermissions.ts
 * 2026-10-24 (boss: ALL permissions right after login, immediately):
 * Every user must be able to use voice freely without hitting a permission
 * wall later — so the moment a user is logged in, ask for everything the
 * app needs, in sequence (Android shows one system dialog at a time):
 *   1. Microphone (voice rooms + calls)
 *   2. Notifications (call/gift alerts)
 *   3. Camera (stories / profile photos)
 *   4. Photos & videos (media library)
 *   5. Nearby devices / Bluetooth (Bluetooth earphones on Android 12+)
 *   6. Battery exemption LAST (it opens system Settings, leaving the app)
 * Runs ONCE per device (AsyncStorage flag) — a deny never blocks the next
 * ask, a missing module never crashes, and already-granted permissions are
 * skipped silently (check-first). The battery step reuses the room-join
 * prompt's once-gate ('vee_battery_prompt_v1'), so users are asked exactly
 * once, at login, instead of on first room join.
 * Denying at login never bricks talk: the seat-take flow still asks for the
 * mic when the user actually takes a seat.
 */
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBatteryExempt, requestBatteryExemption } from './voiceForegroundService';

const FLAG_KEY = 'vee_login_permissions_v1';

async function askMic(): Promise<void> {
  try {
    if (Platform.OS !== 'android') return;
    const P = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (await PermissionsAndroid.check(P)) return;
    await PermissionsAndroid.request(P, {
      title: 'Microphone',
      message: 'Vee needs the microphone for voice rooms and calls.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
      buttonNeutral: 'Later',
    });
  } catch {
    // non-critical — a deny or missing module must not break login
  }
}

async function askNotifications(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return;
    await Notifications.requestPermissionsAsync();
  } catch {
    // non-critical
  }
}

async function askCamera(): Promise<void> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const { status } = await ImagePicker.getCameraPermissionsAsync();
    if (status === 'granted') return;
    await ImagePicker.requestCameraPermissionsAsync();
  } catch {
    // non-critical
  }
}

async function askMedia(): Promise<void> {
  try {
    const MediaLibrary = await import('expo-media-library');
    const { status } = await MediaLibrary.getPermissionsAsync();
    if (status === 'granted') return;
    await MediaLibrary.requestPermissionsAsync();
  } catch {
    // non-critical
  }
}

async function askBluetooth(): Promise<void> {
  try {
    if (Platform.OS !== 'android') return;
    if (Platform.Version < 31) return; // BLUETOOTH is install-time below Android 12
    const P = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    if (await PermissionsAndroid.check(P)) return;
    await PermissionsAndroid.request(P, {
      title: 'Nearby devices',
      message: 'Vee needs nearby-device access for Bluetooth earphones during voice rooms and calls.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
      buttonNeutral: 'Later',
    });
  } catch {
    // non-critical
  }
}

async function askBatteryExemption(): Promise<void> {
  try {
    if (Platform.OS !== 'android') return;
    const asked = await AsyncStorage.getItem('vee_battery_prompt_v1');
    if (asked) return;
    if (await isBatteryExempt()) {
      await AsyncStorage.setItem('vee_battery_prompt_v1', 'exempt');
      return;
    }
    await AsyncStorage.setItem('vee_battery_prompt_v1', 'asked');
    Alert.alert(
      'Keep voice alive',
      'Allow Vee to run without battery restrictions so your voice room or call never disconnects when the screen is off or the app is in the background.',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Allow', onPress: () => requestBatteryExemption() },
      ],
    );
  } catch {
    // non-critical
  }
}

let running = false;

export async function requestAllLoginPermissions(): Promise<void> {
  if (running) return;
  try {
    const done = await AsyncStorage.getItem(FLAG_KEY);
    if (done) return;
    running = true;
    await askMic();
    await askNotifications();
    await askCamera();
    await askMedia();
    await askBluetooth();
    await askBatteryExemption(); // LAST: opens Settings, leaves the app
    await AsyncStorage.setItem(FLAG_KEY, 'done');
  } catch {
    // non-critical — permission asks must never break login
  } finally {
    running = false;
  }
}
