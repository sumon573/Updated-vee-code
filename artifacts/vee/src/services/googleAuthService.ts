/**
 * googleAuthService — Real Google sign-in via expo-web-browser (2026-10-11).
 * NO new native modules. Uses expo-web-browser (already in working build)
 * for the OAuth flow, then Firebase JS SDK signInWithCredential.
 *
 * Flow:
 * 1. Open Google OAuth in system browser via WebBrowser.openAuthSessionAsync
 * 2. Get ID token from redirect
 * 3. Sign in to Firebase with GoogleAuthProvider.credential(idToken)
 */
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleAuthProvider,
  signInWithCredential,
  type User,
} from 'firebase/auth';
import { auth as jsAuth } from '@/src/config/firebase';

WebBrowser.maybeCompleteAuthSession();

/** Web OAuth client ID for vee-chat-36720. */
export const GOOGLE_WEB_CLIENT_ID =
  '396323750389-0d2amdf6b5uhj38aedmsrjhbifih96uh.apps.googleusercontent.com';

/** Redirect URI for our own Firebase Hosting OAuth handler (no Expo dependency). */
const REDIRECT_URI = 'https://vee-chat-36720.firebaseapp.com/oauth/callback';

export const GOOGLE_AUTH_NOT_WIRED = 'GOOGLE_AUTH_NOT_WIRED';
export const GOOGLE_AUTH_CANCELLED = 'GOOGLE_AUTH_CANCELLED';

/**
 * Start Google sign-in via system browser OAuth.
 * Opens Google's account picker, returns after Firebase session is established.
 */
export async function signInWithGoogle(): Promise<User> {
  // Build Google OAuth URL (implicit flow for ID token)
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(GOOGLE_WEB_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    '&response_type=id_token' +
    '&scope=' + encodeURIComponent('openid profile email') +
    '&nonce=' + Math.random().toString(36).substring(2);

  const result = await WebBrowser.openAuthSessionAsync(authUrl, 'vee://oauth');

  if (result.type !== 'success') {
    throw Object.assign(
      new Error('Google sign-in was cancelled.'),
      { code: GOOGLE_AUTH_CANCELLED }
    );
  }

  // Extract ID token from redirect URL (vee://oauth?id_token=... from our handler)
  const url = result.url;
  const fragment = url.split('#')[1] || url.split('?')[1] || '';
  const params = new URLSearchParams(fragment);
  const idToken = params.get('id_token');

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

/** Map a Google-auth error to an i18n key (same pattern as authService). */
export function getGoogleAuthErrorKey(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === GOOGLE_AUTH_CANCELLED) return 'auth.errors.generic';
  if (code === GOOGLE_AUTH_NOT_WIRED) return 'auth.phoneLogin.googlePending';
  const message = (error as { message?: string })?.message ?? '';
  if (/cancelled/i.test(code + message)) return 'auth.errors.generic';
  if (/network/i.test(code + message)) return 'auth.errors.networkFailed';
  return 'auth.phoneLogin.googleError';
}
