/**
 * Auth Service — Firebase Auth (Production)
 * Supports: Email/Password, Password Reset
 * Google Sign-In removed.
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  User,
  AuthError,
} from 'firebase/auth';
import { auth } from '../config/firebase';

export type { User as AuthUser };

// ─── Error Messages ───────────────────────────────────────────────────────────

export function getAuthErrorMessage(error: unknown): string {
  const code = (error as AuthError)?.code ?? '';
  // Returns an i18n KEY (not English text) so callers can translate via t().
  // Keys live under `auth.errors.*` in all 4 locales.
  const keys: Record<string, string> = {
    'auth/user-not-found':         'auth.errors.userNotFound',
    'auth/wrong-password':         'auth.errors.wrongPassword',
    'auth/invalid-credential':     'auth.errors.invalidCredential',
    'auth/email-already-in-use':   'auth.errors.emailInUse',
    'auth/weak-password':          'auth.errors.weakPassword',
    'auth/invalid-email':          'auth.errors.invalidEmail',
    'auth/too-many-requests':      'auth.errors.tooManyRequests',
    'auth/network-request-failed': 'auth.errors.networkFailed',
    'auth/user-disabled':          'auth.errors.userDisabled',
    'auth/operation-not-allowed':  'auth.errors.notAllowed',
    'auth/requires-recent-login':  'auth.errors.recentLogin',
  };
  return keys[code] ?? 'auth.errors.generic';
}

// ─── Core Auth Functions ─────────────────────────────────────────────────────

/** Sign in with email and password */
export async function login(email: string, password: string): Promise<User> {
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  return user;
}

/** Create new account with email, password, and display name */
export async function signUp(
  email: string,
  password: string,
  name: string,
): Promise<User> {
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(user, { displayName: name.trim() });
  return user;
}

/** Sign out the current user */
export async function logout(): Promise<void> {
  await signOut(auth);
}

/** Send password reset email */
export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/** Get currently authenticated user (may be null) */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/** Subscribe to auth state changes. Returns unsubscribe function. */
export function onUserStateChanged(
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}

/** Update display name and/or photo URL */
export async function updateUserProfile(
  name?: string,
  photoURL?: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user.');
  await updateProfile(user, {
    ...(name && { displayName: name }),
    ...(photoURL && { photoURL }),
  });
}
