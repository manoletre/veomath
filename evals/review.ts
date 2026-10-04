import { randomInt } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ItemResult, RunMeta } from './types';

export const RESULTS_DIR = path.join(process.cwd(), 'evals', 'results');
export const REVIEW_COUNT = 30;

export interface ResultIndex {
  itemId: string;
  model: string;
  score: number;
  firstAttemptScore: number;
  retried: boolean;
  finishedAt: string;
}

export interface ReviewEntry {
  itemId: string;
  model: string;
  rating: number | null;
  notes: string;
  reviewedAt: string | null;
}

export interface ReviewSession {
  version: 1;
  runId: string;
  createdAt: string;
  entries: ReviewEntry[];
}

export function validSegment(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) && value !== '.' && value !== '..';
}

export function runDir(runId: string) {
  if (!validSegment(runId)) throw new Error('Invalid run ID');
  return path.join(RESULTS_DIR, runId);
}

export function modelSlug(model: string) {
  return model.replace(/\//g, '__');
}

export async function listRuns(): Promise<RunMeta[]> {
  let dirs: string[];
  try { dirs = await readdir(RESULTS_DIR); } catch { return []; }
  const runs = await Promise.all(dirs.filter(validSegment).map(async (id) => {
    try { return JSON.parse(await readFile(path.join(runDir(id), 'run.json'), 'utf8')) as RunMeta; }
    catch { return null; }
  }));
  return runs.filter((run): run is RunMeta => run !== null).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function readResultIndex(run: RunMeta): Promise<ResultIndex[]> {
  const results = await Promise.all(run.models.flatMap((model) => run.itemIds.map(async (itemId) => {
    try {
      const result = JSON.parse(await readFile(resultPath(run.runId, model, itemId), 'utf8')) as ItemResult;
      return { itemId, model, score: result.score, firstAttemptScore: result.firstAttemptScore, retried: result.retried, finishedAt: result.finishedAt };
    } catch { return null; }
  })));
  return results.filter((result): result is ResultIndex => result !== null);
}

export function resultPath(runId: string, model: string, itemId: string) {
  if (!validSegment(itemId) || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid result ID');
  return path.join(runDir(runId), modelSlug(model), `${itemId}.json`);
}

export async function readReview(runId: string): Promise<ReviewSession | null> {
  try { return JSON.parse(await readFile(path.join(runDir(runId), 'manual-review.json'), 'utf8')) as ReviewSession; }
  catch { return null; }
}

export async function writeReview(review: ReviewSession) {
  const target = path.join(runDir(review.runId), 'manual-review.json');
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(review, null, 2) + '\n');
  await rename(temp, target);
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function sampleReviews(runId: string, results: ResultIndex[]): ReviewSession {
  const models = shuffle([...new Set(results.map((r) => r.model))]);
  const byModel = new Map(models.map((model) => [model, shuffle(results.filter((r) => r.model === model))]));
  const picked: ResultIndex[] = [];
  const seenItems = new Set<string>();
  const count = Math.min(REVIEW_COUNT, results.length);
  while (picked.length < count) {
    let progressed = false;
    for (const model of models) {
      if (picked.length >= count) break;
      const remaining = byModel.get(model)!;
      if (!remaining.length) continue;
      const index = remaining.findIndex((r) => !seenItems.has(r.itemId));
      const [result] = remaining.splice(index < 0 ? 0 : index, 1);
      picked.push(result);
      seenItems.add(result.itemId);
      progressed = true;
    }
    if (!progressed) break;
  }
  return {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    entries: shuffle(picked).map(({ model, itemId }) => ({ model, itemId, rating: null, notes: '', reviewedAt: null })),
  };
}
