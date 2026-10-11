/**
 * googleAuthService — Native Google sign-in (2026-10-12).
 * Uses @react-native-google-signin/google-signin for the NATIVE account
 * picker (phone's Google accounts, IMO-style). Then Firebase JS SDK
 * signInWithCredential with the ID token.
 *
 * Sumon explicitly requested the native picker (no browser flow).
 */
import {
  GoogleSignin,
  statusCodes,
  type User as GoogleUser,
} from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  type User,
} from 'firebase/auth';
import { auth as jsAuth } from '@/src/config/firebase';

/** Web OAuth client ID for vee-chat-36720. */
export const GOOGLE_WEB_CLIENT_ID =
  '396323750389-0d2amdf6b5uhj38aedmsrjhbifih96uh.apps.googleusercontent.com';

export const GOOGLE_AUTH_NOT_WIRED = 'GOOGLE_AUTH_NOT_WIRED';
export const GOOGLE_AUTH_CANCELLED = 'GOOGLE_AUTH_CANCELLED';

let configured = false;

/** Configure the native Google Sign-In module (call once). */
function ensureConfigured() {
  if (!configured) {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: false,
    });
    configured = true;
  }
}

/**
 * Start native Google sign-in.
 * Shows the phone's Google accounts picker (native UI).
 * Returns after Firebase session is established.
 */
export async function signInWithGoogle(): Promise<User> {
  ensureConfigured();

  // Check if Play Services are available (Android)
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // This shows the NATIVE account picker
  const response = await GoogleSignin.signIn();
  const idToken = response.data?.idToken;

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

/** Sign out from Google (native). */
export async function signOutGoogle(): Promise<void> {
  ensureConfigured();
  try {
    await GoogleSignin.signOut();
  } catch {
    // Ignore — user may not have been signed in via Google
  }
}

/** Map a Google-auth error to an i18n key. */
export function getGoogleAuthErrorKey(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === statusCodes.SIGN_IN_CANCELLED || code === GOOGLE_AUTH_CANCELLED) {
    return 'auth.errors.generic';
  }
  if (code === statusCodes.IN_PROGRESS) {
    return 'auth.errors.generic';
  }
  if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
    return 'auth.errors.networkFailed';
  }
  if (code === GOOGLE_AUTH_NOT_WIRED) return 'auth.phoneLogin.googlePending';
  const message = (error as { message?: string })?.message ?? '';
  if (/cancelled/i.test(code + message)) return 'auth.errors.generic';
  if (/network/i.test(code + message)) return 'auth.errors.networkFailed';
  return 'auth.phoneLogin.googleError';
}
