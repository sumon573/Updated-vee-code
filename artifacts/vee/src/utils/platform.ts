/**
 * Platform Utilities — shared helpers for runtime environment detection.
 *
 * Centralised here so callers (useLivekitVoiceRoom, pushNotificationService, etc.)
 * don't each duplicate the same Expo Go detection logic.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Returns true when the app is running inside Expo Go (the store client).
 *
 * Native modules that require a custom dev client or production build
 * (OneSignal, LiveKit, etc.) must guard on this function and short-circuit
 * all native calls when it returns true.
 */
export function isExpoGo(): boolean {
  try {
    return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  } catch {
    // If expo-constants is unavailable, assume native build (safe default).
    return false;
  }
}

/**
 * Returns the base API URL. For Replit development, EXPO_PUBLIC_DOMAIN is
 * injected by the workflow. Production builds should set
 * EXPO_PUBLIC_API_BASE_URL to the deployed API artifact URL.
 */
export function getApiBase(): string {
  const explicitBase = process.env['EXPO_PUBLIC_API_BASE_URL'];
  if (explicitBase) {
    return explicitBase.replace(/\/$/, '');
  }
  const domain = process.env['EXPO_PUBLIC_DOMAIN'];
  if (domain) {
    // Normalise: strip any trailing slash, add https:// if scheme is absent.
    const normalised = domain.replace(/\/$/, '');
    return normalised.startsWith('http') ? normalised : `https://${normalised}`;
  }
  throw new Error(
    'API endpoint is not configured. Set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_DOMAIN.',
  );
}

/**
 * Read the API base without allowing optional startup work to crash the app.
 * Callers that need the API for a user action should continue using getApiBase()
 * so a missing deployment configuration remains an explicit, actionable error.
 */
export function tryGetApiBase(): string | null {
  try {
    return getApiBase();
  } catch {
    return null;
  }
}
