'use client';

import { auth } from './firebase-client';

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Google to continue');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.error === 'string' ? body.error : 'Request failed. Please try again.');
}
