import { NextRequest, NextResponse } from 'next/server';
import { listRuns, readResultIndex, readReview, sampleReviews, validSegment, writeReview } from '@/evals/review';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { action?: string; runId?: string; model?: string; itemId?: string; rating?: number | null; notes?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const runId = body.runId ?? '';
  if (!validSegment(runId)) return NextResponse.json({ error: 'Invalid run' }, { status: 400 });
  const run = (await listRuns()).find((r) => r.runId === runId);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  if (body.action === 'start') {
    const existing = await readReview(runId);
    if (existing) return NextResponse.json(existing);
    const review = sampleReviews(runId, await readResultIndex(run));
    if (!review.entries.length) return NextResponse.json({ error: 'No responses to review' }, { status: 400 });
    await writeReview(review);
    return NextResponse.json(review);
  }

  if (body.action === 'rate') {
    const review = await readReview(runId);
    if (!review) return NextResponse.json({ error: 'Start a review first' }, { status: 400 });
    const entry = review.entries.find((e) => e.model === body.model && e.itemId === body.itemId);
    if (!entry) return NextResponse.json({ error: 'Response is not in this review' }, { status: 400 });
    if (body.rating !== null && (!Number.isInteger(body.rating) || body.rating! < 1 || body.rating! > 5)) {
      return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 });
    }
    if (typeof body.notes !== 'string' || body.notes.length > 5000) return NextResponse.json({ error: 'Notes must be under 5,000 characters' }, { status: 400 });
    entry.rating = body.rating ?? null;
    entry.notes = body.notes;
    entry.reviewedAt = entry.rating === null ? null : new Date().toISOString();
    await writeReview(review);
    return NextResponse.json(review);
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
