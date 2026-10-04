'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const app = getApps().length ? getApp() : initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'demo-veomath',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo-veomath.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-veomath',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'demo-veomath',
});

export const auth = getAuth(app);

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true' && !auth.emulatorConfig) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
