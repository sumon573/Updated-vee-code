/**
 * Error display utility (2026-10-10, Sumon's standing order).
 * EVERYWHERE in the app, when any problem/error occurs, show the ACTUAL
 * cause — not just a generic message. This is how the room creation error
 * was diagnosed (photoURL undefined).
 *
 * Usage:
 *   import { showErrorWithCause } from '@/src/utils/errorDisplay';
 *   try {
 *     await doSomething();
 *   } catch (e) {
 *     showErrorWithCause('Could not send gift', e);
 *   }
 */
import { Alert } from 'react-native';

/**
 * Show an error alert with the actual cause.
 * @param title - User-friendly title (e.g., "Could not send gift")
 * @param error - The caught error (any type)
 * @param options - Optional: custom message prefix
 */
export function showErrorWithCause(
  title: string,
  error: unknown,
  options?: { prefix?: string }
): void {
  const cause = getErrorCause(error);
  const prefix = options?.prefix || '';
  Alert.alert(
    title,
    `${prefix}Could not complete the action.\n\nReason: ${cause}\n\nIf this keeps happening, please send a screenshot.`
  );
}

/**
 * Extract a human-readable cause from any error type.
 */
export function getErrorCause(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    // Include both message and code if available
    const code = (error as any).code;
    return code ? `${error.message} (code: ${code})` : error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Log error with cause for debugging (console + optional crash reporting).
 */
export function logErrorWithCause(context: string, error: unknown): void {
  const cause = getErrorCause(error);
  console.error(`[${context}] ${cause}`, error);
}
