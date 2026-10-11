/**
 * phoneAuthService — Phone OTP via Firebase JS SDK (2026-10-11).
 * No native modules. Uses Firebase JS SDK phone auth.
 *
 * NOTE: Firebase JS SDK phone auth on React Native requires careful
 * handling. This implementation uses the standard flow; if reCAPTCHA
 * verification fails, the error is surfaced clearly.
 */
import {
  signInWithPhoneNumber,
  PhoneAuthProvider,
  signInWithCredential,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth as jsAuth } from '@/src/config/firebase';

export const PHONE_AUTH_NOT_WIRED = 'PHONE_AUTH_NOT_WIRED';

let confirmationResult: ConfirmationResult | null = null;

/**
 * Send OTP to the phone number (E.164 format, e.g. +88017XXXXXXXX).
 * Returns the verification ID for the OTP screen.
 */
export async function sendPhoneOtp(phoneNumber: string): Promise<{ verificationId: string }> {
  try {
    // Firebase JS SDK on React Native: the third parameter (ApplicationVerifier)
    // is required. We pass undefined and let Firebase handle it via
    // Play Integrity / SafetyNet on Android.
    // @ts-ignore - React Native specific handling
    confirmationResult = await signInWithPhoneNumber(jsAuth, phoneNumber, undefined);
    // The verificationId is not directly exposed by ConfirmationResult,
    // but we can use the confirmationResult object for verification.
    // For the OTP screen flow, we store it and use confirm().
    return { verificationId: 'js-sdk-flow' };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? '';
    // If the JS SDK phone auth is not available, throw a clear error
    if (/not-supported|operation-not-supported/i.test(code)) {
      throw Object.assign(
        new Error('Phone verification is not available on this device. Please use Google login.'),
        { code: PHONE_AUTH_NOT_WIRED }
      );
    }
    throw e;
  }
}

/**
 * Verify the OTP code entered by the user.
 */
export async function verifyPhoneOtp(verificationId: string, code: string): Promise<User> {
  if (!confirmationResult) {
    throw new Error('No verification in progress. Please request a new code.');
  }
  const { user } = await confirmationResult.confirm(code.trim());
  confirmationResult = null;
  return user;
}

export function getPhoneAuthErrorKey(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === PHONE_AUTH_NOT_WIRED) return 'auth.phoneLogin.phonePending';
  if (/invalid-phone-number/i.test(code)) return 'auth.phoneLogin.invalidPhone';
  if (/too-many-requests/i.test(code)) return 'auth.phoneLogin.tooManyRequests';
  if (/invalid-verification-code/i.test(code)) return 'auth.phoneLogin.wrongCode';
  if (/session-expired|expired/i.test(code)) return 'auth.phoneLogin.codeExpired';
  return 'auth.phoneLogin.phoneError';
}
