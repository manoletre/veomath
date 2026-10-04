import Link from 'next/link';
import datasetJson from '@/evals/dataset.json';
import { listRuns, readResultIndex, readReview } from '@/evals/review';
import type { Dataset } from '@/evals/types';
import EvalDashboard from './EvalDashboard';

export const metadata = { title: 'Benchmark results · veomath' };
export const dynamic = 'force-dynamic';

export default async function EvalPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const runs = await listRuns();
  const requested = (await searchParams).run;
  const run = runs.find((r) => r.runId === requested) ?? runs[0];
  if (!run) {
    return (
      <main className="h-screen overflow-y-auto bg-[#0a0a0a] px-8 py-12 text-[#e5e5e5]">
        <Link href="/" className="text-sm text-[#999]">← veomath</Link>
        <h1 className="mt-8 text-3xl font-semibold">Benchmark results</h1>
        <p className="mt-4 text-[#999]">No benchmark runs found in evals/results. Run <code>pnpm eval</code> first.</p>
      </main>
    );
  }
  const [results, review] = await Promise.all([readResultIndex(run), readReview(run.runId)]);
  return <EvalDashboard key={run.runId} runs={runs.map((r) => ({ runId: r.runId, startedAt: r.startedAt }))} run={run} results={results} initialReview={review} dataset={datasetJson as Dataset} />;
}
