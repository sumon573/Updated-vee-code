/**
 * First-launch permission requests (2026-10-10).
 * Requests all needed permissions on first app open, per Sumon's order.
 * Safe: each request is wrapped in try/catch; failures are non-fatal.
 */
import { Platform } from 'react-native';
import { PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

const FIRST_LAUNCH_KEY = '@vee_permissions_requested_v1';

/**
 * Request all app permissions on first launch.
 * Returns true if this was the first launch (permissions were requested).
 */
export async function requestAllPermissionsOnFirstLaunch(): Promise<boolean> {
  try {
    const alreadyRequested = await AsyncStorage.getItem(FIRST_LAUNCH_KEY);
    if (alreadyRequested === 'true') return false;

    // Mark as requested FIRST (so we don't loop on failure)
    await AsyncStorage.setItem(FIRST_LAUNCH_KEY, 'true');

    if (Platform.OS === 'android') {
      // Microphone (voice rooms, calls)
      try {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'Vee needs microphone access for voice rooms and calls.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          }
        );
      } catch { /* non-fatal */ }

      // Camera (profile photos, stories) — via image-picker
      try {
        await ImagePicker.requestCameraPermissionsAsync();
      } catch { /* non-fatal */ }

      // Media library (photos, stories)
      try {
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      } catch { /* non-fatal */ }
    } else {
      // iOS
      try {
        await ImagePicker.requestCameraPermissionsAsync();
      } catch { /* non-fatal */ }
      try {
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      } catch { /* non-fatal */ }
      // Microphone on iOS is requested via expo-av when needed
    }

    return true;
  } catch {
    return false;
  }
}
