import 'server-only';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function adminApp() {
  // Initialize on the first request so builds do not need deployment credentials.
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  // A service account key works on any host; without one, fall back to Application Default Credentials.
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  return getApps()[0] || initializeApp({
    projectId,
    credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
  });
}

export const getAdminAuth = () => getAuth(adminApp());
export const getDb = () => getFirestore(adminApp());
