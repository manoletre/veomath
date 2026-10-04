import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../lib/firebase-admin';
import { readJson } from '../../lib/request-validation';
import { requireUser, securityError } from '../../lib/server-security';

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const body = await readJson(request, 2000);
    const { sessionId, slideIndex } = body;
    const counters = [body.viewedSeconds, body.clicks, body.drags, body.controlChanges];
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId) ||
      typeof slideIndex !== 'number' || !Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex > 100 ||
      !counters.every(value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000)) {
      return NextResponse.json({ error: 'Invalid activity' }, { status: 400 });
    }
    const [viewedSeconds, clicks, drags, controlChanges] = counters as number[];
    const ref = getDb().doc(`users/${user.uid}/animationActivity/${sessionId}-${slideIndex}`);
    await ref.set({
      sessionId, slideIndex,
      viewedSeconds: FieldValue.increment(viewedSeconds),
      clicks: FieldValue.increment(clicks),
      drags: FieldValue.increment(drags),
      controlChanges: FieldValue.increment(controlChanges),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return securityError(error, 'Failed to record activity');
  }
}
