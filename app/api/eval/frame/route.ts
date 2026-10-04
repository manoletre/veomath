import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { listRuns, modelSlug, resultPath, runDir, validSegment } from '@/evals/review';
import type { ItemResult } from '@/evals/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const runId = params.get('run') ?? '';
  const model = params.get('model') ?? '';
  const itemId = params.get('item') ?? '';
  const kind = params.get('kind');
  const attemptIndex = Number(params.get('attempt'));
  if (!validSegment(runId) || !validSegment(itemId) || !['final', 'interacted'].includes(kind ?? '') ||
      !Number.isInteger(attemptIndex) || attemptIndex < 0) {
    return NextResponse.json({ error: 'Invalid frame' }, { status: 400 });
  }
  try {
    const run = (await listRuns()).find((r) => r.runId === runId);
    if (!run || !run.models.includes(model) || !run.itemIds.includes(itemId)) throw new Error('Unknown result');
    const result = JSON.parse(await readFile(resultPath(runId, model, itemId), 'utf8')) as ItemResult;
    const relative = result.attempts[attemptIndex]?.frames[kind as 'final' | 'interacted'];
    const expected = `${modelSlug(model)}/${itemId}.${attemptIndex}.${kind}.jpg`;
    if (!relative || relative !== expected) throw new Error('Frame unavailable');
    const bytes = await readFile(`${runDir(runId)}/${relative}`);
    return new NextResponse(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch {
    return NextResponse.json({ error: 'Frame not found' }, { status: 404 });
  }
}
