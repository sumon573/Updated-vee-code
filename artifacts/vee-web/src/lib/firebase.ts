/**
 * Firebase — shared with the Vee native app.
 * Project: vee-chat-36720 (same project as the Expo app).
 *
 * NOTE: These client keys are public by design (Firebase web config is meant
 * to ship in the client bundle). No secrets are stored here.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  type Auth,
} from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
// Internal Firebase APIs (present at runtime; not in the public .d.ts).
// Used only as a fallback if the bundler drops Firebase's own registration.
// @ts-expect-error - internal API not in public types
import { _registerComponent as firebaseRegisterComponent } from '@firebase/app';
import { Component as FirebaseComponent } from '@firebase/component';
// @ts-expect-error - internal API not in public types
import { _repoManagerDatabaseFromApp as repoManagerDatabaseFromApp } from '@firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyDCand6KLEI4jsOtkmcQSoUryEpszAfUjY',
  authDomain: 'vee-chat-36720.firebaseapp.com',
  databaseURL:
    'https://vee-chat-36720-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'vee-chat-36720',
  storageBucket: 'vee-chat-36720.firebasestorage.app',
  messagingSenderId: '396323750389',
  appId: '1:396323750389:web:cede1dadf1760f04d7e0bc',
};

// Prevent duplicate app initialization (HMR safe).
const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const auth: Auth = getAuth(app);
// Persist sessions in localStorage so the user stays signed in across restarts.
void setPersistence(auth, browserLocalPersistence);

const rtdb: Database = getDatabaseResilient(app);

export { app, auth, rtdb };

/**
 * Get the Realtime Database instance, working around bundlers (esbuild/terser)
 * that tree-shake Firebase's own top-level `registerDatabase()` side-effect
 * call. If the component was dropped, register it manually and retry.
 */
function getDatabaseResilient(app: FirebaseApp): Database {
  try {
    return getDatabase(app);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('is not available')) {
      throw err;
    }
    // The bundler dropped Firebase's component registration — do it ourselves.
    // (Types are bypassed: these are Firebase's internal runtime APIs.)
    const ComponentCtor = FirebaseComponent as unknown as new (
      name: string,
      factory: (container: any, opts: any) => unknown,
      type: string,
    ) => { setMultipleInstances: (v: boolean) => unknown };
    firebaseRegisterComponent(
      new ComponentCtor(
        'database',
        (container: any, { instanceIdentifier: url }: any) => {
          const scopedApp = container.getProvider('app').getImmediate();
          return (repoManagerDatabaseFromApp as any)(
            scopedApp,
            container.getProvider('auth-internal'),
            container.getProvider('app-check-internal'),
            url,
          );
        },
        'PUBLIC',
      ).setMultipleInstances(true) as never,
    );
    return getDatabase(app);
  }
}
