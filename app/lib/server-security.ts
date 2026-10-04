import 'server-only';

import OpenAI from 'openai';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getDb } from './firebase-admin';

const DAILY_LIMIT = 10;

export class QuotaExceededError extends Error {
  constructor() { super('Daily limit of 10 OpenAI calls reached. Try again tomorrow (UTC).'); }
}

export async function requireUser(request: NextRequest): Promise<DecodedIdToken | NextResponse> {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
  if (!match) return NextResponse.json({ error: 'Sign in with Google to continue' }, { status: 401 });
  try {
    const user = await getAdminAuth().verifyIdToken(match[1], true);
    if (user.firebase.sign_in_provider !== 'google.com') {
      return NextResponse.json({ error: 'Google sign-in is required' }, { status: 403 });
    }
    if (process.env.NODE_ENV === 'production' && (!user.email_verified || !user.email)) {
      return NextResponse.json({ error: 'A verified Google email is required' }, { status: 403 });
    }
    return user;
  } catch {
    return NextResponse.json({ error: 'Session expired. Sign in again.' }, { status: 401 });
  }
}

export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function publicError(error: unknown, fallback: string): { error: string; status: number } {
  // The SDK wraps errors from its fetch hook in APIConnectionError.
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (cause instanceof QuotaExceededError) return { error: cause.message, status: 429 };
    if (cause instanceof RequestError) return { error: cause.message, status: cause.status };
    cause = cause.cause;
  }
  // Never send upstream error bodies, request headers, or credentials to the browser.
  return { error: fallback, status: 500 };
}

export function securityError(error: unknown, fallback: string): NextResponse {
  const result = publicError(error, fallback);
  return NextResponse.json({ error: result.error }, { status: result.status });
}

async function consumeOpenAiCall(uid: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const db = getDb();
  const ref = db.doc(`users/${uid}/dailyUsage/${day}`);
  const allowed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const count = snapshot.exists ? Number(snapshot.data()?.count || 0) : 0;
    if (count >= DAILY_LIMIT) return false;
    transaction.set(ref, { count: count + 1, date: day, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!allowed) throw new QuotaExceededError();
}

// This fetch runs before every actual OpenAI HTTP request, including retries and file uploads.
// A failed or retried upstream request still spends one of the ten daily slots.
export function meteredOpenAI(uid: string): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  return new OpenAI({
    apiKey,
    fetch: async (input, init) => {
      // The SDK probes FormData support with fetch('data:,') before uploads.
      // That local probe is not an OpenAI HTTP request and must not spend quota.
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') await consumeOpenAiCall(uid);
      return fetch(input, init);
    },
  });
}

export async function recordPrompt(uid: string, source: string, prompt: string, sessionId?: string): Promise<void> {
  await getDb().collection('users').doc(uid).collection('prompts').add({
    source,
    prompt,
    sessionId: typeof sessionId === 'string' ? sessionId.slice(0, 100) : null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function readRemaining(uid: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const snapshot = await getDb().doc(`users/${uid}/dailyUsage/${day}`).get();
  return Math.max(0, DAILY_LIMIT - Number(snapshot.data()?.count || 0));
}
