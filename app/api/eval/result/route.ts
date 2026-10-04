import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { resultPath, validSegment, listRuns } from '@/evals/review';
import type { ItemResult } from '@/evals/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get('run') ?? '';
  const model = request.nextUrl.searchParams.get('model') ?? '';
  const itemId = request.nextUrl.searchParams.get('item') ?? '';
  if (!validSegment(runId) || !validSegment(itemId)) return NextResponse.json({ error: 'Invalid result' }, { status: 400 });
  try {
    const run = (await listRuns()).find((r) => r.runId === runId);
    if (!run || !run.models.includes(model) || !run.itemIds.includes(itemId)) return NextResponse.json({ error: 'Result not found' }, { status: 404 });
    const result = JSON.parse(await readFile(resultPath(runId, model, itemId), 'utf8')) as ItemResult;
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Result not found' }, { status: 404 });
  }
}
