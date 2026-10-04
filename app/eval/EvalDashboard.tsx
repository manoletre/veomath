'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ResultIndex, ReviewSession } from '@/evals/review';
import { CHECK_DESCRIPTIONS, CHECK_IDS, type Dataset, type ItemResult, type RunMeta } from '@/evals/types';

const ManimRenderer = dynamic(() => import('@/app/components/ManimRenderer'), { ssr: false });
const card = 'rounded-xl border border-[#292929] bg-[#151515]';
const muted = 'text-[#969696]';
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
    <main className="h-screen overflow-y-auto bg-[#0a0a0a] text-[#e8e8e8]">
      <div className="mx-auto max-w-[1640px] px-5 py-7 md:px-8">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-[#252525] pb-7">
          <div>
            <Link href="/" className={`text-xs ${muted}`}>← veomath</Link>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">Benchmark results</h1>
            <p className={`mt-2 text-sm ${muted}`}>{results.length} responses · {run.models.length} models · {run.itemIds.length} prompts</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`text-xs ${muted}`} htmlFor="run-select">Run</label>
            <select id="run-select" className="rounded-lg border border-[#383838] bg-[#191919] px-3 py-2 text-sm" value={run.runId} onChange={(event) => { window.location.href = `/eval?run=${encodeURIComponent(event.target.value)}`; }}>
              {runs.map((r) => <option key={r.runId} value={r.runId}>{r.runId}</option>)}
            </select>
            <button onClick={startReview} disabled={busy} className="rounded-lg bg-[#e8e8e8] px-4 py-2 text-sm font-semibold text-[#111] hover:bg-white disabled:opacity-50">
              {review ? `Continue manual review · ${reviewedCount}/${review.entries.length}` : 'Manually evaluate 30'}
            </button>
          </div>
        </header>

        {dataset.version !== run.datasetVersion && <p className="mt-5 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-200">This run used dataset v{run.datasetVersion}; the current prompt list is v{dataset.version}. Check the saved run before comparing prompts.</p>}
        {actionError && <p role="alert" className="mt-5 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-300">{actionError}</p>}

        <div className="mt-7 flex gap-5 border-b border-[#282828] text-sm">
          <button onClick={() => { setMode('results'); setSelected(null); }} className={`pb-3 ${mode === 'results' ? 'border-b-2 border-white text-white' : muted}`}>All results</button>
          <button onClick={startReview} className={`pb-3 ${mode === 'review' ? 'border-b-2 border-white text-white' : muted}`}>Manual review {review ? `(${reviewedCount}/${review.entries.length})` : ''}</button>
        </div>

        {mode === 'results' && <>
          <section className="mt-7">
            <div className="mb-3 flex items-end justify-between gap-4"><div><h2 className="text-lg font-semibold">Model comparison</h2><p className={`mt-1 text-xs ${muted}`}>Automatic score checks rendering and interaction, not mathematical correctness. Missing responses are excluded from the mean.</p></div></div>
            <div className="grid gap-3 lg:grid-cols-3">
              {[...run.summaries].sort((a, b) => b.meanScore - a.meanScore).map((summary, index) => (
                <button key={summary.model} onClick={() => { setModelFilter(summary.model); document.getElementById('responses')?.scrollIntoView({ behavior: 'smooth' }); }} className={`${card} p-4 text-left transition-colors hover:border-[#555]`}>
                  <div className="flex items-start justify-between gap-3"><div><span className="text-xs text-[#727272]">#{index + 1} · {summary.items} responses</span><h3 className="mt-1 break-all text-sm font-medium">{summary.model}</h3></div><strong className="text-xl tabular-nums">{score(summary.meanScore)}</strong></div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#303030]"><div className="h-full rounded-full bg-[#8ccfb0]" style={{ width: score(summary.meanScore) }} /></div>
                  <div className="mt-3 flex justify-between text-xs text-[#929292]"><span>Full pass {score(summary.fullPassRate)}</span><span>Retries {score(summary.retryRate)}</span></div>
                </button>
              ))}
            </div>
          </section>
        </>}

        {mode === 'review' && review && <ReviewSummary review={review} results={resultMap} />}

        <section id="responses" className="mt-9">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-lg font-semibold">{mode === 'review' ? 'Review queue' : 'Responses'}</h2><p className={`mt-1 text-xs ${muted}`}>{mode === 'review' ? 'One saved random sample, spread across models and prompts. Ratings are stored with this run.' : 'Select a response to inspect its trace, checks, and visualization.'}</p></div>
            {mode === 'results' && <div className="flex flex-wrap gap-2">
              <input aria-label="Search responses" placeholder="Search model or prompt" value={query} onChange={(event) => setQuery(event.target.value)} className="w-52 rounded-lg border border-[#333] bg-[#171717] px-3 py-2 text-sm outline-none focus:border-[#777]" />
              <select aria-label="Filter model" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} className="max-w-56 rounded-lg border border-[#333] bg-[#171717] px-3 py-2 text-sm"><option value="all">All models</option>{run.models.map((model) => <option key={model}>{model}</option>)}</select>
              <select aria-label="Sort responses" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-lg border border-[#333] bg-[#171717] px-3 py-2 text-sm"><option value="score">Lowest score first</option><option value="model">By model</option><option value="prompt">By prompt</option></select>
            </div>}
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,370px)_minmax(0,1fr)]">
            <div className={`${card} max-h-[72vh] overflow-y-auto p-2`}>
              {mode === 'results' && visibleResults.map((r) => <ResponseRow key={pairKey(r.model, r.itemId)} result={r} prompt={items.get(r.itemId)?.prompt ?? r.itemId} active={selected?.model === r.model && selected.itemId === r.itemId} onClick={() => setSelected({ model: r.model, itemId: r.itemId })} />)}
              {mode === 'results' && visibleResults.length === 0 && <p className={`p-4 text-sm ${muted}`}>No matching responses.</p>}
              {mode === 'review' && review?.entries.map((entry, index) => {
                const result = resultMap.get(pairKey(entry.model, entry.itemId));
                return <ResponseRow key={pairKey(entry.model, entry.itemId)} result={result} prompt={items.get(entry.itemId)?.prompt ?? entry.itemId} active={selected?.model === entry.model && selected.itemId === entry.itemId} onClick={() => setSelected({ model: entry.model, itemId: entry.itemId })} reviewLabel={`${index + 1}/${review.entries.length}`} rating={entry.rating} />;
              })}
            </div>
            <div className="min-w-0">
              {!selected && <div className={`${card} flex min-h-80 items-center justify-center p-8 text-center text-sm ${muted}`}>Choose a response to inspect it.</div>}
              {selected && !detail && !detailError && <div className={`${card} p-8 text-sm ${muted}`}>Loading response…</div>}
              {selected && detailError && <div className={`${card} p-8 text-sm text-red-300`}>{detailError}</div>}
              {selected && detail && <>
                <ResultDetail key={pairKey(selected.model, selected.itemId)} runId={run.runId} result={detail} item={items.get(selected.itemId)} />
                {mode === 'review' && selectedReview && <div className={`${card} mt-5 p-5`}>
                  <h3 className="text-base font-semibold">Your judgment</h3>
                  <p className={`mt-1 text-xs ${muted}`}>Rate the mathematical accuracy, clarity, layout, and whether the interaction actually works.</p>
                  <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Manual rating">
                    {[
                      [1, 'Broken'], [2, 'Poor'], [3, 'Mixed'], [4, 'Good'], [5, 'Excellent'],
                    ].map(([value, label]) => <button key={value} aria-pressed={rating === value} onClick={() => setRating(value as number)} className={`rounded-lg border px-3 py-2 text-sm ${rating === value ? 'border-[#8ccfb0] bg-[#183328] text-[#b9efd0]' : 'border-[#383838] text-[#aaa] hover:border-[#777]'}`}>{value} · {label}</button>)}
                  </div>
                  <textarea aria-label="Review notes" placeholder="What is mathematically right or wrong? What fails visually or when interacting?" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} rows={3} className="mt-4 w-full resize-y rounded-lg border border-[#383838] bg-[#101010] p-3 text-sm outline-none focus:border-[#777]" />
                  <div className="mt-3 flex items-center justify-between gap-3"><span className={`text-xs ${muted}`}>{selectedIndex ? `Automatic score ${score(selectedIndex.score)}` : ''}</span><button disabled={busy || rating === null} onClick={saveRating} className="rounded-lg bg-[#8ccfb0] px-4 py-2 text-sm font-semibold text-[#102018] disabled:opacity-40">{busy ? 'Saving…' : 'Save rating & next'}</button></div>
                </div>}
              </>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ResponseRow({ result, prompt, active, onClick, reviewLabel, rating }: { result?: ResultIndex; prompt: string; active: boolean; onClick: () => void; reviewLabel?: string; rating?: number | null }) {
  return <button onClick={onClick} className={`mb-1 w-full rounded-lg border p-3 text-left ${active ? 'border-[#7aa78e] bg-[#1d2b23]' : 'border-transparent hover:bg-[#222]'}`}>
    <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-all text-xs font-medium text-[#c9c9c9]">{reviewLabel && <span className="mr-2 text-[#7a7a7a]">{reviewLabel}</span>}{result?.model ?? 'Missing response'}</span><span className={`shrink-0 text-xs tabular-nums ${rating != null ? 'text-[#b9efd0]' : 'text-[#bcbcbc]'}`}>{rating != null ? `Your ${rating}/5` : result ? score(result.score) : '—'}</span></div>
    <p className="mt-2 line-clamp-2 text-sm leading-snug">{prompt}</p>
    <div className="mt-2 flex items-center gap-2 text-[11px] text-[#848484]"><code>{result?.itemId}</code>{result?.retried && <span className="text-amber-300">retried</span>}</div>
  </button>;
}

function ReviewSummary({ review, results }: { review: ReviewSession; results: Map<string, ResultIndex> }) {
  const rated = review.entries.filter((e) => e.rating !== null);
  const models = [...new Set(review.entries.map((e) => e.model))];
  return <section className="mt-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Manual check</h2><p className={`mt-1 text-xs ${muted}`}>{rated.length} of {review.entries.length} rated · created {new Date(review.createdAt).toLocaleString()}</p></div><div className="text-2xl font-semibold tabular-nums">{Math.round(rated.length / review.entries.length * 100)}%</div></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#303030]"><div className="h-full rounded-full bg-[#8ccfb0]" style={{ width: `${rated.length / review.entries.length * 100}%` }} /></div>
    {rated.length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-3">{models.map((model) => {
      const group = rated.filter((e) => e.model === model);
      if (!group.length) return null;
      const manual = group.reduce((total, e) => total + e.rating!, 0) / group.length;
      const automatic = group.reduce((total, e) => total + (results.get(pairKey(e.model, e.itemId))?.score ?? 0), 0) / group.length;
      return <div key={model} className={`${card} p-3 text-xs`}><div className="break-all font-medium">{model}</div><div className="mt-2 flex justify-between text-[#aaa]"><span>Your rating <b className="text-white">{manual.toFixed(1)}/5</b></span><span>Auto <b className="text-white">{score(automatic)}</b></span></div><p className="mt-1 text-[#777]">{group.length} reviewed response{group.length === 1 ? '' : 's'}</p></div>;
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
  return <article className={`${card} overflow-hidden`}>
    <div className="border-b border-[#2b2b2b] p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="break-all text-xs text-[#8ccfb0]">{result.model} · {result.itemId}</div><strong className="text-sm">Auto {score(result.score)}</strong></div><h3 className="mt-3 text-lg font-medium leading-snug">{item?.prompt ?? result.itemId}</h3>{item && <p className={`mt-2 text-xs ${muted}`}>{item.category} · Grade {item.grade} · {item.tags.join(', ')}</p>}</div>
    <div className="p-5">
      {result.attempts.length > 1 && <div className="mb-5 flex gap-2">{result.attempts.map((a, index) => <button key={index} onClick={() => { setAttemptIndex(index); setReplay(false); setFrameKind('final'); }} className={`rounded-lg border px-3 py-1.5 text-xs ${attemptIndex === index ? 'border-[#8ccfb0] text-[#b9efd0]' : 'border-[#444] text-[#999]'}`}>{index + 1}. {a.kind} · {score(a.score)}</button>)}</div>}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div><h4 className="text-sm font-semibold">Generation trace</h4><p className={`mt-1 text-xs ${muted}`}>{(attempt.generation.latencyMs / 1000).toFixed(1)}s · {attempt.generation.inputTokens ?? '—'} input tokens · {attempt.generation.outputTokens ?? '—'} output tokens</p><p className="mt-1 text-xs text-[#777]">Recorded output and diagnostics; private model reasoning was not saved.</p></div>
          {attempt.generation.error && <pre className="whitespace-pre-wrap break-words rounded-lg border border-red-900 bg-red-950/20 p-3 text-xs text-red-300">{attempt.generation.error}</pre>}
          {attempt.generation.explanation && <div><h5 className="mb-2 text-xs font-medium text-[#aaa]">Explanation</h5><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0c0c0c] p-3 font-sans text-sm leading-relaxed">{attempt.generation.explanation}</pre></div>}
          <details><summary className="cursor-pointer text-xs text-[#aaa]">Raw model response · full</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0c0c0c] p-3 text-xs">{attempt.generation.rawResponse || 'No raw response saved'}</pre></details>
          <details><summary className="cursor-pointer text-xs text-[#aaa]">Generated code · full</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0c0c0c] p-3 text-xs">{attempt.code ?? 'No code generated'}</pre></details>
          <div><h5 className="mb-2 text-xs font-medium text-[#aaa]">Automatic checks</h5><div className="space-y-1.5">{CHECK_IDS.map((id) => { const check = attempt.checks[id]; if (!check) return null; return <details key={id} className="rounded-lg bg-[#1c1c1c] px-3 py-2 text-xs"><summary className="flex cursor-pointer items-center justify-between gap-2"><span title={CHECK_DESCRIPTIONS[id]}>{id}</span><span className={check.pass === true ? 'text-[#8ccfb0]' : check.pass === false ? 'text-[#f3a3a3]' : 'text-[#777]'}>{check.pass === true ? 'Pass' : check.pass === false ? 'Fail' : 'N/A'}</span></summary>{check.detail && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-[#333] pt-2 text-[#aaa]">{check.detail}</pre>}</details>; })}</div></div>
          <details><summary className="cursor-pointer text-xs text-[#aaa]">Render diagnostics</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0c0c0c] p-3 text-xs">{JSON.stringify(attempt.render, null, 2) ?? 'No render'}</pre></details>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Visualization</h4>{attempt.code && <button onClick={() => setReplay((value) => !value)} className="rounded-lg border border-[#555] px-3 py-1.5 text-xs hover:border-[#aaa]">{replay ? 'Stop replay' : '▶ Replay animation'}</button>}</div>
          <p className={`mt-1 text-xs ${muted}`}>Saved frames show the settled scene and the result after automated interaction. Replay to inspect the full animation and try its controls.</p>
          <div className="mt-3 overflow-hidden rounded-lg border border-[#333] bg-black" style={{ aspectRatio: '16/9' }}>
            {replay && attempt.code ? <ManimRenderer code={attempt.code} renderKey={attemptIndex} /> : frame ? <Image src={frameUrl} alt={`${frameKind} frame for ${result.itemId}`} width={640} height={360} unoptimized className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-sm text-[#777]">No {frameKind} frame saved</div>}
          </div>
          {!replay && <div className="mt-3 flex gap-2"><button onClick={() => setFrameKind('final')} className={`rounded-lg border px-3 py-1.5 text-xs ${frameKind === 'final' ? 'border-[#8ccfb0] text-[#b9efd0]' : 'border-[#444] text-[#999]'}`}>Final frame</button><button onClick={() => setFrameKind('interacted')} className={`rounded-lg border px-3 py-1.5 text-xs ${frameKind === 'interacted' ? 'border-[#8ccfb0] text-[#b9efd0]' : 'border-[#444] text-[#999]'}`}>After interaction</button></div>}
          {item && <div className="mt-6"><h5 className="text-sm font-semibold">Math checklist</h5><p className={`mt-1 text-xs ${muted}`}>Use these prompt-specific expectations to guide your judgment.</p><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#c3c3c3]">{item.checklist.map((check) => <li key={check}>{check}</li>)}</ul></div>}
        </div>
      </div>
    </div>
  </article>;
}
