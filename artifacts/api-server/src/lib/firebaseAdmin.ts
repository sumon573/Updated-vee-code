/**
 * Shared Firebase Admin SDK singleton (firebase-admin v14 modular API).
 *
 * v14 removed the namespaced `admin.auth()` / `admin.database()` /
 * `admin.apps` API from the main entry — the modular subpath imports below
 * are the only correct form. Importing the old namespace compiles under
 * esbuild but throws `TypeError` at runtime, so every route MUST use this
 * helper instead of `import * as admin from "firebase-admin"`.
 *
 * Fail-closed: if credentials are missing or init throws, `isAdminReady()`
 * returns false and routes answer 500 without ever touching Firebase.
 */
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  getDatabase,
  ServerValue,
  type Database,
} from "firebase-admin/database";
import { logger } from "./logger";

const DATABASE_URL =
  process.env["FIREBASE_DATABASE_URL"] ??
  "https://vee-chat-36720-default-rtdb.asia-southeast1.firebasedatabase.app";

/** Non-null when module-load init failed; routes fail closed with 500. */
let adminInitError: string | null = null;
let app: App | null = null;

function initFirebaseAdmin(): void {
  if (app) return;
  try {
    const existing = getApps();
    if (existing.length > 0) {
      app = existing[0] ?? null;
      return;
    }
    const serviceAccountJson = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      app = initializeApp({
        credential: cert(serviceAccount),
        databaseURL: DATABASE_URL,
      });
    } else if (process.env["GOOGLE_APPLICATION_CREDENTIALS"]) {
      app = initializeApp({
        credential: applicationDefault(),
        databaseURL: DATABASE_URL,
      });
    } else {
      throw new Error(
        "Missing Firebase credentials: set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS",
      );
    }
    logger.info("Firebase Admin SDK initialized");
  } catch (err) {
    adminInitError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to initialize Firebase Admin SDK");
  }
}

initFirebaseAdmin();

/** True when the Admin SDK initialized successfully. */
export function isAdminReady(): boolean {
  return app !== null && adminInitError === null;
}

/** Human-readable init failure, or null when healthy. */
export function getAdminInitError(): string | null {
  return adminInitError;
}

function requireApp(): App {
  if (!app) {
    throw new Error(
      `Firebase Admin SDK not initialized${adminInitError ? `: ${adminInitError}` : ""}`,
    );
  }
  return app;
}

/** Verify a client Firebase ID token. Throws when the SDK isn't ready. */
export function verifyIdToken(idToken: string) {
  return getAuth(requireApp()).verifyIdToken(idToken);
}

/** RTDB Database instance. Throws when the SDK isn't ready. */
export function adminDatabase(): Database {
  return getDatabase(requireApp());
}

/** Re-export of RTDB ServerValue (TIMESTAMP / increment). */
export { ServerValue };
