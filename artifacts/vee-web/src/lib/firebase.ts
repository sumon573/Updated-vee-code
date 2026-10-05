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

const rtdb: Database = getDatabase(app);

export { app, auth, rtdb };
