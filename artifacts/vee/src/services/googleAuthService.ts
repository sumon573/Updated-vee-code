/**
 * googleAuthService — Google sign-in via expo-web-browser (2026-10-12).
 * Pure JS, NO native modules (native picker crashed the app).
 *
 * Uses expo-web-browser (already in working build) for OAuth implicit flow.
 * NOTE: Requires the Expo proxy redirect URI to be whitelisted in Google
 * Cloud Console, otherwise Google shows redirect_uri_mismatch. The app
 * does NOT crash — the error is shown translated in the UI.
 */
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleAuthProvider,
  signInWithCredential,
  type User,
} from 'firebase/auth';
import { auth as jsAuth } from '@/src/config/firebase';

/** Web OAuth client ID for vee-chat-36720. */
export const GOOGLE_WEB_CLIENT_ID =
  '396323750389-0d2amdf6b5uhj38aedmsrjhbifih96uh.apps.googleusercontent.com';

/** Expo auth proxy redirect URI. */
const REDIRECT_URI = 'https://auth.expo.io/@kidoge5908s-team/vee';

export const GOOGLE_AUTH_NOT_WIRED = 'GOOGLE_AUTH_NOT_WIRED';
export const GOOGLE_AUTH_CANCELLED = 'GOOGLE_AUTH_CANCELLED';

/**
 * Start Google sign-in via system browser.
 * Returns after Firebase session is established.
 * Throws with a translatable error — never crashes the app.
 */
export async function signInWithGoogle(): Promise<User> {
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(GOOGLE_WEB_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    '&response_type=id_token' +
    '&scope=' +
    encodeURIComponent('openid profile email') +
    `&nonce=${Date.now()}`;

  const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error(GOOGLE_AUTH_CANCELLED);
  }
  if (result.type !== 'success' || !result.url) {
    throw new Error('Google sign-in did not complete.');
  }

  // Extract id_token from the redirect URL fragment
  const match = result.url.match(/[#&]id_token=([^&]+)/);
  const idToken = match?.[1];
  if (!idToken) {
    throw new Error('Google sign-in did not return an ID token.');
  }

  const credential = GoogleAuthProvider.credential(idToken);
  const { user } = await signInWithCredential(jsAuth, credential);
  return user;
}

/**
 * Sign in with a Google ID token (alternative entry point).
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<User> {
  if (!idToken) {
    throw new Error('Google sign-in did not return an ID token.');
  }
  const credential = GoogleAuthProvider.credential(idToken);
  const { user } = await signInWithCredential(jsAuth, credential);
  return user;
}

/** Map a Google-auth error to an i18n key. */
export function getGoogleAuthErrorKey(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const message = (error as { message?: string })?.message ?? '';
  if (code === GOOGLE_AUTH_CANCELLED || /cancel/i.test(message)) {
    return 'auth.errors.generic';
  }
  if (code === GOOGLE_AUTH_NOT_WIRED) return 'auth.phoneLogin.googlePending';
  if (/network/i.test(code + message)) return 'auth.errors.networkFailed';
  return 'auth.phoneLogin.googleError';
}
