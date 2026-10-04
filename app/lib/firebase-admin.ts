import 'server-only';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function adminApp() {
  // Initialize on the first request so builds do not need deployment credentials.
  if (process.env.NODE_ENV === 'production' &&
    (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error('Firebase emulators must not be enabled in production');
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || (process.env.NODE_ENV !== 'production' ? 'demo-veomath' : undefined);
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  return getApps()[0] || initializeApp({
    projectId,
    ...(process.env.FIREBASE_AUTH_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
  });
}

export const getAdminAuth = () => getAuth(adminApp());
export const getDb = () => getFirestore(adminApp());
