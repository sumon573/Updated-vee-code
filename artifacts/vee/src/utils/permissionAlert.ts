/**
 * Permission-denial alerts with an "Open Settings" escape hatch.
 *
 * When a permission is denied with `canAskAgain === false` (the user chose
 * "Don't ask again" / "Don't allow"), re-requesting the permission will never
 * show the system dialog again — so every denial alert in that state must
 * offer a path to the OS Settings screen, otherwise the feature is a dead end.
 */
import { Alert, Linking } from 'react-native';

function openSettings(): void {
  Linking.openSettings().catch(() => {
    /* background: safe to swallow — settings deep link is best-effort */
  });
}

/**
 * Alert for a permanently-denied permission: explains the situation and
 * offers "Open Settings" alongside "Cancel".
 */
export function alertPermissionPermanentlyDenied(
  title: string,
  message: string,
): void {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open Settings', onPress: openSettings },
  ]);
}

/**
 * Alert for a denied-then-dismissed microphone request where the message
 * already tells the user to allow it in Settings. Adds the action button.
 */
export function alertMicDeniedWithSettings(
  title: string,
  message: string,
  okLabel: string,
): void {
  Alert.alert(title, message, [
    { text: okLabel, style: 'cancel' },
    { text: 'Open Settings', onPress: openSettings },
  ]);
}
