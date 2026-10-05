'use client';

import { signOut } from 'firebase/auth';
import { auth } from './firebase-client';

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Google to continue');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  // The server rejected the session (e.g. user deleted or token revoked).
  // Drop the stale local session so AuthGate shows the sign-in screen instead of failing forever.
  if (response.status === 401 && auth.currentUser?.uid === user.uid) await signOut(auth);
  return response;
}

export async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.error === 'string' ? body.error : 'Request failed. Please try again.');
}
