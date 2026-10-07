/**
 * Firebase Configuration — Production Setup
 * Vee App — vee-chat-36720
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
// @firebase/auth (imported directly, not via the 'firebase' wrapper) is used
// because its package.json exports map has a "react-native" condition that
// Metro can actually match, unlike 'firebase/auth', whose exports map lacks
// that condition and always resolves to the browser build — which doesn't
// export getReactNativePersistence and throws at import time on launch.
import { initializeAuth, getAuth, type Auth } from '@firebase/auth';
import { getDatabase } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';

// getReactNativePersistence is imported dynamically to avoid a crash at
// import time if Metro resolves the browser build of @firebase/auth
// (which doesn't export it). Static import would throw on launch.
let getReactNativePersistence: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const authModule = require('@firebase/auth');
  getReactNativePersistence = authModule.getReactNativePersistence;
} catch {
  // Browser build — persistence not available, will init without it
}

const firebaseConfig = {
  apiKey: 'AIzaSyDCand6KLEI4jsOtkmcQSoUryEpszAfUjY',
  authDomain: 'vee-chat-36720.firebaseapp.com',
  databaseURL: 'https://vee-chat-36720-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'vee-chat-36720',
  storageBucket: 'vee-chat-36720.firebasestorage.app',
  messagingSenderId: '396323750389',
  appId: '1:396323750389:web:cede1dadf1760f04d7e0bc',
};

// Prevent duplicate app initialization (hot reload safe)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth with AsyncStorage persistence for React Native
// This keeps the user logged in across app restarts
let auth: Auth;
try {
  // FIX: getReactNativePersistence may not exist if Metro resolves the
  // browser build of @firebase/auth (depends on pnpm lockfile structure).
  // Check for existence to avoid "not a function" crash on launch.
  const persistence =
    typeof getReactNativePersistence === 'function'
      ? getReactNativePersistence(AsyncStorage)
      : undefined;
  auth = initializeAuth(app, persistence ? { persistence } : {});
} catch {
  // Auth already initialized (hot reload)
  auth = getAuth(app);
}

export { auth };
export const database = getDatabase(app);
export default app;
