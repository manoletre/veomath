'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEffect, useMemo, useState } from 'react';
import type { ResultIndex, ReviewSession } from '@/evals/review';
import { CHECK_DESCRIPTIONS, CHECK_IDS, type Dataset, type ItemResult, type RunMeta } from '@/evals/types';

const ManimRenderer = dynamic(() => import('@/app/components/ManimRenderer'), { ssr: false });
const card = 'rounded-xl border border-border bg-card';
const muted = 'text-muted-foreground';
const score = (value: number) => `${Math.round(value * 100)}%`;
const pairKey = (model: string, itemId: string) => `${model}::${itemId}`;

type Selection = { model: string; itemId: string };

export default function EvalDashboard({ runs, run, results, initialReview, dataset }: {
  runs: { runId: string; startedAt: string }[];
  run: RunMeta;
  results: ResultIndex[];
  initialReview: ReviewSession | null;
  dataset: Dataset;
}) {
  const [mode, setMode] = useState<'results' | 'review'>('results');
  const [review, setReview] = useState(initialReview);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<ItemResult | null>(null);
  const [detailError, setDetailError] = useState('');
  const [modelFilter, setModelFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'score' | 'model' | 'prompt'>('score');
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const items = useMemo(() => new Map(dataset.items.map((item) => [item.id, item])), [dataset]);
  const resultMap = useMemo(() => new Map(results.map((r) => [pairKey(r.model, r.itemId), r])), [results]);
  const reviewedCount = review?.entries.filter((e) => e.rating !== null).length ?? 0;
  const selectedReview = review?.entries.find((e) => e.model === selected?.model && e.itemId === selected?.itemId);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDetail(null);
    setDetailError('');
    fetch(`/api/eval/result?${new URLSearchParams({ run: run.runId, model: selected.model, item: selected.itemId })}`)
      .then(async (response) => { if (!response.ok) throw new Error('Could not load this response'); return response.json() as Promise<ItemResult>; })
      .then((value) => { if (!cancelled) setDetail(value); })
      .catch((error) => { if (!cancelled) setDetailError(String(error)); });
    return () => { cancelled = true; };
  }, [selected, run.runId]);

  useEffect(() => {
    setRating(selectedReview?.rating ?? null);
    setNotes(selectedReview?.notes ?? '');
  }, [selected?.model, selected?.itemId, selectedReview?.rating, selectedReview?.notes]);

  const visibleResults = useMemo(() => results
    .filter((r) => modelFilter === 'all' || r.model === modelFilter)
    .filter((r) => `${r.model} ${r.itemId} ${items.get(r.itemId)?.prompt ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'score' ? a.score - b.score || a.model.localeCompare(b.model)
      : sort === 'model' ? a.model.localeCompare(b.model) || a.itemId.localeCompare(b.itemId)
      : a.itemId.localeCompare(b.itemId) || a.model.localeCompare(b.model)), [results, modelFilter, query, sort, items]);

  async function startReview() {
    setMode('review');
    setActionError('');
    if (review) {
      const next = review.entries.find((e) => e.rating === null) ?? review.entries[0];
      if (next) setSelected({ model: next.model, itemId: next.itemId });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/eval/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', runId: run.runId }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Could not start review');
      setReview(value);
      if (value.entries[0]) setSelected({ model: value.entries[0].model, itemId: value.entries[0].itemId });
    } catch (error) { setActionError(String(error)); }
    finally { setBusy(false); }
  }

  async function saveRating() {
    if (!selected || !review || rating === null) return;
    setBusy(true);
    setActionError('');
    try {
      const response = await fetch('/api/eval/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rate', runId: run.runId, ...selected, rating, notes }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Could not save rating');
      setReview(value);
      const currentIndex = value.entries.findIndex((e: { model: string; itemId: string }) => e.model === selected.model && e.itemId === selected.itemId);
      const remaining = [...value.entries.slice(currentIndex + 1), ...value.entries.slice(0, currentIndex)].find((e: { rating: number | null }) => e.rating === null);
      if (remaining) setSelected({ model: remaining.model, itemId: remaining.itemId });
    } catch (error) { setActionError(String(error)); }
    finally { setBusy(false); }
  }

  const selectedIndex = selected ? resultMap.get(pairKey(selected.model, selected.itemId)) : null;

  return (
    <Tabs value={mode} onValueChange={value => {
      if (value === 'review') void startReview();
      else { setMode('results'); setSelected(null); }
    }} asChild>
    <main className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-[1640px] px-5 py-5 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <Link href="/" className={`text-xs ${muted}`}>← veomath</Link>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">Benchmark results</h1>
            <p className={`mt-2 text-sm ${muted}`}>{results.length} responses · {run.models.length} models · {run.itemIds.length} prompts</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`text-xs ${muted}`} htmlFor="run-select">Run</label>
            <NativeSelect id="run-select" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={run.runId} onChange={(event) => { window.location.href = `/eval?run=${encodeURIComponent(event.target.value)}`; }}>
              {runs.map((r) => <NativeSelectOption key={r.runId} value={r.runId}>{r.runId}</NativeSelectOption>)}
            </NativeSelect>
            <Button variant="outline" onClick={startReview} disabled={busy} className="bg-primary px-4 py-2 text-base font-bold text-primary-foreground hover:bg-primary/90">
              {review ? `Continue manual review · ${reviewedCount}/${review.entries.length}` : 'Manually evaluate 30'}
            </Button>
          </div>
        </header>

        {dataset.version !== run.datasetVersion && <p className="mt-5 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-200">This run used dataset v{run.datasetVersion}; the current prompt list is v{dataset.version}. Check the saved run before comparing prompts.</p>}
        {actionError && <p role="alert" className="mt-5 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-300">{actionError}</p>}

        <TabsList aria-label="Evaluation view" className="mt-5 h-11 border border-border bg-card">
          <TabsTrigger value="results" className="text-base">All results</TabsTrigger>
          <TabsTrigger value="review" className="text-base">Manual review {review ? `(${reviewedCount}/${review.entries.length})` : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value={mode} className="m-0">

        {mode === 'results' && <>
          <section className="mt-5">
            <div className="mb-3 flex items-end justify-between gap-4"><div><h2 className="text-lg font-semibold">Model comparison</h2><p className={`mt-1 text-xs ${muted}`}>Automatic score checks rendering and interaction, not mathematical correctness. Missing responses are excluded from the mean.</p></div></div>
            <div className="grid gap-3 lg:grid-cols-3">
              {[...run.summaries].sort((a, b) => b.meanScore - a.meanScore).map((summary, index) => (
                <Button variant="outline" key={summary.model} onClick={() => { setModelFilter(summary.model); document.getElementById('responses')?.scrollIntoView({ behavior: 'smooth' }); }} className={`${card} block h-auto whitespace-normal p-4 text-left transition-colors hover:border-border`}>
                  <div className="flex items-start justify-between gap-3"><div><span className="text-xs text-muted-foreground">#{index + 1} · {summary.items} responses</span><h3 className="mt-1 break-all text-sm font-medium">{summary.model}</h3></div><strong className="text-xl tabular-nums">{score(summary.meanScore)}</strong></div>
                  <Progress value={summary.meanScore * 100} aria-label={`${summary.model} automatic score`} className="mt-4 h-2" />
                  <div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>Full pass {score(summary.fullPassRate)}</span><span>Retries {score(summary.retryRate)}</span></div>
                </Button>
              ))}
            </div>
          </section>
        </>}

        {mode === 'review' && review && <ReviewSummary review={review} results={resultMap} />}

        <section id="responses" className="mt-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-lg font-semibold">{mode === 'review' ? 'Review queue' : 'Responses'}</h2><p className={`mt-1 text-xs ${muted}`}>{mode === 'review' ? 'One saved random sample, spread across models and prompts. Ratings are stored with this run.' : 'Select a response to inspect its trace, checks, and visualization.'}</p></div>
            {mode === 'results' && <div className="flex flex-wrap gap-2">
              <Input aria-label="Search responses" placeholder="Search model or prompt" value={query} onChange={(event) => setQuery(event.target.value)} className="w-52 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border" />
              <NativeSelect aria-label="Filter model" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} className="max-w-56 rounded-lg border border-border bg-background px-3 py-2 text-sm"><NativeSelectOption value="all">All models</NativeSelectOption>{run.models.map((model) => <NativeSelectOption key={model}>{model}</NativeSelectOption>)}</NativeSelect>
              <NativeSelect aria-label="Sort responses" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><NativeSelectOption value="score">Lowest score first</NativeSelectOption><NativeSelectOption value="model">By model</NativeSelectOption><NativeSelectOption value="prompt">By prompt</NativeSelectOption></NativeSelect>
            </div>}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,370px)_minmax(0,1fr)]">
            <Card className={`${card} max-h-[72vh] overflow-y-auto p-2`}>
              {mode === 'results' && visibleResults.map((r) => <ResponseRow key={pairKey(r.model, r.itemId)} result={r} prompt={items.get(r.itemId)?.prompt ?? r.itemId} active={selected?.model === r.model && selected.itemId === r.itemId} onClick={() => setSelected({ model: r.model, itemId: r.itemId })} />)}
              {mode === 'results' && visibleResults.length === 0 && <p className={`p-4 text-sm ${muted}`}>No matching responses.</p>}
              {mode === 'review' && review?.entries.map((entry, index) => {
                const result = resultMap.get(pairKey(entry.model, entry.itemId));
                return <ResponseRow key={pairKey(entry.model, entry.itemId)} result={result} prompt={items.get(entry.itemId)?.prompt ?? entry.itemId} active={selected?.model === entry.model && selected.itemId === entry.itemId} onClick={() => setSelected({ model: entry.model, itemId: entry.itemId })} reviewLabel={`${index + 1}/${review.entries.length}`} rating={entry.rating} />;
              })}
            </Card>
            <div className="min-w-0">
              {!selected && <Card className={`${card} flex min-h-80 items-center justify-center p-8 text-center text-sm ${muted}`}>Choose a response to inspect it.</Card>}
              {selected && !detail && !detailError && <Card className={`${card} p-8 text-sm ${muted}`}>Loading response…</Card>}
              {selected && detailError && <Card className={`${card} p-8 text-sm text-red-300`}>{detailError}</Card>}
              {selected && detail && <>
                <ResultDetail key={pairKey(selected.model, selected.itemId)} runId={run.runId} result={detail} item={items.get(selected.itemId)} />
                {mode === 'review' && selectedReview && <Card className={`${card} mt-5 p-4`}>
                  <h3 className="text-base font-semibold">Your judgment</h3>
                  <p className={`mt-1 text-xs ${muted}`}>Rate the mathematical accuracy, clarity, layout, and whether the interaction actually works.</p>
                  <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Manual rating">
                    {[
                      [1, 'Broken'], [2, 'Poor'], [3, 'Mixed'], [4, 'Good'], [5, 'Excellent'],
                    ].map(([value, label]) => <Button variant="outline" key={value} aria-pressed={rating === value} onClick={() => setRating(value as number)} className={`rounded-lg border px-3 py-2 text-sm ${rating === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:border-input'}`}>{value} · {label}</Button>)}
                  </div>
                  <Textarea aria-label="Review notes" placeholder="What is mathematically right or wrong? What fails visually or when interacting?" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} rows={3} className="mt-4 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-border" />
                  <div className="mt-3 flex items-center justify-between gap-3"><span className={`text-xs ${muted}`}>{selectedIndex ? `Automatic score ${score(selectedIndex.score)}` : ''}</span><Button variant="outline" disabled={busy || rating === null} onClick={saveRating} className="bg-primary px-4 py-2 text-base font-bold text-primary-foreground hover:bg-primary/90">{busy ? 'Saving…' : 'Save rating & next'}</Button></div>
                </Card>}
              </>}
            </div>
          </div>
        </section>
        </TabsContent>
      </div>
    </main>
    </Tabs>
  );
}

function ResponseRow({ result, prompt, active, onClick, reviewLabel, rating }: { result?: ResultIndex; prompt: string; active: boolean; onClick: () => void; reviewLabel?: string; rating?: number | null }) {
  return <Button variant="outline" onClick={onClick} className={`mb-1 block h-auto w-full whitespace-normal rounded-lg border p-3 text-left ${active ? 'border-input bg-secondary' : 'border-transparent hover:bg-secondary'}`}>
    <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-all text-xs font-medium text-foreground">{reviewLabel && <span className="mr-2 text-muted-foreground">{reviewLabel}</span>}{result?.model ?? 'Missing response'}</span><span className={`shrink-0 text-xs tabular-nums ${rating != null ? 'text-emerald-200' : 'text-muted-foreground'}`}>{rating != null ? `Your ${rating}/5` : result ? score(result.score) : '—'}</span></div>
    <p className="mt-2 line-clamp-2 text-sm leading-snug">{prompt}</p>
    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><code>{result?.itemId}</code>{result?.retried && <span className="text-amber-300">retried</span>}</div>
  </Button>;
}

function ReviewSummary({ review, results }: { review: ReviewSession; results: Map<string, ResultIndex> }) {
  const rated = review.entries.filter((e) => e.rating !== null);
  const models = [...new Set(review.entries.map((e) => e.model))];
  return <section className="mt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Manual check</h2><p className={`mt-1 text-xs ${muted}`}>{rated.length} of {review.entries.length} rated · created {new Date(review.createdAt).toLocaleString()}</p></div><div className="text-2xl font-semibold tabular-nums">{Math.round(rated.length / review.entries.length * 100)}%</div></div>
    <Progress value={rated.length / review.entries.length * 100} aria-label="Review completion" className="mt-3 h-2" />
    {rated.length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-3">{models.map((model) => {
      const group = rated.filter((e) => e.model === model);
      if (!group.length) return null;
      const manual = group.reduce((total, e) => total + e.rating!, 0) / group.length;
      const automatic = group.reduce((total, e) => total + (results.get(pairKey(e.model, e.itemId))?.score ?? 0), 0) / group.length;
      return <Card key={model} className={`${card} p-3 text-xs`}><div className="break-all font-medium">{model}</div><div className="mt-2 flex justify-between text-muted-foreground"><span>Your rating <b className="text-white">{manual.toFixed(1)}/5</b></span><span>Auto <b className="text-white">{score(automatic)}</b></span></div><p className="mt-1 text-muted-foreground">{group.length} reviewed response{group.length === 1 ? '' : 's'}</p></Card>;
    })}</div>}
  </section>;
}

function ResultDetail({ runId, result, item }: { runId: string; result: ItemResult; item?: Dataset['items'][number] }) {
  const [attemptIndex, setAttemptIndex] = useState(result.attempts.length - 1);
  const [frameKind, setFrameKind] = useState<'final' | 'interacted'>('final');
  const [replay, setReplay] = useState(false);
  const attempt = result.attempts[attemptIndex];
  const frame = attempt.frames[frameKind];
  const frameUrl = `/api/eval/frame?${new URLSearchParams({ run: runId, model: result.model, item: result.itemId, attempt: String(attemptIndex), kind: frameKind })}`;
  return <Card className={`${card} overflow-hidden`}>
    <div className="border-b border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="break-all text-xs text-muted-foreground">{result.model} · {result.itemId}</div><strong className="text-sm">Auto {score(result.score)}</strong></div><h3 className="mt-3 text-lg font-medium leading-snug">{item?.prompt ?? result.itemId}</h3>{item && <p className={`mt-2 text-xs ${muted}`}>{item.category} · Grade {item.grade} · {item.tags.join(', ')}</p>}</div>
    <div className="p-4">
      {result.attempts.length > 1 && <div className="mb-5 flex gap-2">{result.attempts.map((a, index) => <Button variant="outline" key={index} onClick={() => { setAttemptIndex(index); setReplay(false); setFrameKind('final'); }} className={`rounded-lg border px-3 py-1.5 text-xs ${attemptIndex === index ? 'border-input bg-secondary text-foreground' : 'border-border text-muted-foreground'}`}>{index + 1}. {a.kind} · {score(a.score)}</Button>)}</div>}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div><h4 className="text-sm font-semibold">Generation trace</h4><p className={`mt-1 text-xs ${muted}`}>{(attempt.generation.latencyMs / 1000).toFixed(1)}s · {attempt.generation.inputTokens ?? '—'} input tokens · {attempt.generation.outputTokens ?? '—'} output tokens</p><p className="mt-1 text-xs text-muted-foreground">Recorded output and diagnostics; private model reasoning was not saved.</p></div>
          {attempt.generation.error && <pre className="whitespace-pre-wrap break-words rounded-lg border border-red-900 bg-red-950/20 p-3 text-xs text-red-300">{attempt.generation.error}</pre>}
          {attempt.generation.explanation && <div><h5 className="mb-2 text-xs font-medium text-muted-foreground">Explanation</h5><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-sm leading-relaxed">{attempt.generation.explanation}</pre></div>}
          <details><summary className="cursor-pointer text-xs text-muted-foreground">Raw model response · full</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{attempt.generation.rawResponse || 'No raw response saved'}</pre></details>
          <details><summary className="cursor-pointer text-xs text-muted-foreground">Generated code · full</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{attempt.code ?? 'No code generated'}</pre></details>
          <div><h5 className="mb-2 text-xs font-medium text-muted-foreground">Automatic checks</h5><div className="space-y-1.5">{CHECK_IDS.map((id) => { const check = attempt.checks[id]; if (!check) return null; return <details key={id} className="rounded-lg bg-secondary px-3 py-2 text-xs"><summary className="flex cursor-pointer items-center justify-between gap-2"><span title={CHECK_DESCRIPTIONS[id]}>{id}</span><span className={check.pass === true ? 'text-emerald-200' : check.pass === false ? 'text-muted-foreground' : 'text-muted-foreground'}>{check.pass === true ? 'Pass' : check.pass === false ? 'Fail' : 'N/A'}</span></summary>{check.detail && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-border pt-2 text-muted-foreground">{check.detail}</pre>}</details>; })}</div></div>
          <details><summary className="cursor-pointer text-xs text-muted-foreground">Render diagnostics</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{JSON.stringify(attempt.render, null, 2) ?? 'No render'}</pre></details>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Visualization</h4>{attempt.code && <Button variant="outline" onClick={() => setReplay((value) => !value)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-border">{replay ? 'Stop replay' : '▶ Replay animation'}</Button>}</div>
          <p className={`mt-1 text-xs ${muted}`}>Saved frames show the settled scene and the result after automated interaction. Replay to inspect the full animation and try its controls.</p>
          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-black" style={{ aspectRatio: '16/9' }}>
            {replay && attempt.code ? <ManimRenderer code={attempt.code} renderKey={attemptIndex} /> : frame ? <Image src={frameUrl} alt={`${frameKind} frame for ${result.itemId}`} width={640} height={360} unoptimized className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No {frameKind} frame saved</div>}
          </div>
          {!replay && <div className="mt-3 flex gap-2"><Button variant="outline" onClick={() => setFrameKind('final')} className={`rounded-lg border px-3 py-1.5 text-xs ${frameKind === 'final' ? 'border-input bg-secondary text-foreground' : 'border-border text-muted-foreground'}`}>Final frame</Button><Button variant="outline" onClick={() => setFrameKind('interacted')} className={`rounded-lg border px-3 py-1.5 text-xs ${frameKind === 'interacted' ? 'border-input bg-secondary text-foreground' : 'border-border text-muted-foreground'}`}>After interaction</Button></div>}
          {item && <div className="mt-5"><h5 className="text-sm font-semibold">Math checklist</h5><p className={`mt-1 text-xs ${muted}`}>Use these prompt-specific expectations to guide your judgment.</p><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground">{item.checklist.map((check) => <li key={check}>{check}</li>)}</ul></div>}
        </div>
      </div>
    </div>
  </Card>;
}
