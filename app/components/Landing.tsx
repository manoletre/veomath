'use client';

import { ArrowDown, ArrowUp, Hand } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LoginButtonSocial1 } from '@/components/login-button-social-1';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LANDING_DEMOS, type LandingDemo } from '../lib/landing-demos';
import ManimRenderer from './ManimRenderer';
import MathLogo from './MathLogo';

interface LandingProps {
  onSignIn: () => void;
  signingIn: boolean;
  error: string;
}

const TYPE_MS_PER_CHAR = 28;
const THINKING_MS = 900;

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Becomes true once the element is mostly on screen, and stays true. */
function useSeen<T extends Element>(threshold: number) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setSeen(true);
      observer.disconnect();
    }, { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

type Stage = 'waiting' | 'typing' | 'thinking' | 'shown';

function DemoSection({ demo, index, total, onSignIn, signingIn }: {
  demo: LandingDemo;
  index: number;
  total: number;
  onSignIn: () => void;
  signingIn: boolean;
}) {
  const [ref, seen] = useSeen<HTMLDivElement>(0.4);
  const [typed, setTyped] = useState(0);
  const [stage, setStage] = useState<Stage>('waiting');
  const [interacted, setInteracted] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const isLast = index === total - 1;

  // Prompt types itself in, "sends", then the visualization appears.
  useEffect(() => {
    if (!seen) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const length = demo.prompt.length;
    const timers: number[] = [];
    if (reduceMotion) {
      timers.push(window.setTimeout(() => { setTyped(length); setStage('shown'); }, 0));
    } else {
      let count = 0;
      timers.push(window.setTimeout(() => setStage('typing'), 0));
      const typing = window.setInterval(() => {
        count++;
        setTyped(count);
        if (count < length) return;
        window.clearInterval(typing);
        setStage('thinking');
        timers.push(window.setTimeout(() => setStage('shown'), THINKING_MS));
      }, TYPE_MS_PER_CHAR);
      timers.push(typing);
    }
    return () => timers.forEach(id => { window.clearTimeout(id); window.clearInterval(id); });
  }, [seen, demo.prompt]);

  const sent = stage === 'thinking' || stage === 'shown';

  return <section id={`demo-${index}`} aria-label={`Example ${index + 1}`} className="landing-section">
    <div ref={ref} className="mx-auto flex w-full max-w-[960px] flex-col gap-5">
      <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Example {index + 1} of {total}</p>

      <div className={`landing-reveal ${seen ? 'is-visible' : ''} flex items-center gap-2 rounded-xl border border-input bg-secondary py-2 pl-4 pr-2`}>
        <p className="min-h-[1.6em] flex-1 py-1 text-lg md:text-xl" aria-label={demo.prompt}>
          <span aria-hidden="true">{demo.prompt.slice(0, typed)}</span>
          {stage === 'typing' && <span className="landing-caret" aria-hidden="true" />}
        </p>
        <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-md transition-colors ${sent ? 'bg-accent text-muted-foreground' : 'bg-primary text-primary-foreground'}`}><ArrowUp className="size-4" /></span>
      </div>

      <div className={`landing-reveal ${sent ? 'is-visible' : ''} relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black`}
        onPointerDown={() => setInteracted(true)}>
        {stage === 'thinking' && <div role="status" className="absolute inset-0 grid place-items-center text-base text-muted-foreground"><span className="thinking-dots">Thinking it through</span></div>}
        {stage === 'shown' && (renderError
          ? <div className="absolute inset-0 grid place-items-center p-6 text-center text-muted-foreground">This demo needs WebGL to run in your browser.</div>
          : <ManimRenderer code={demo.code} renderKey={0} onError={() => setRenderError(true)} />)}
      </div>

      <div className={`landing-reveal ${stage === 'shown' ? 'is-visible' : ''} flex flex-col gap-5`}>
        <p className={`flex items-center gap-2 text-base ${interacted ? 'text-muted-foreground' : 'text-[var(--warning)]'}`}>
          <Hand className={`size-4 shrink-0 ${interacted ? '' : 'landing-nudge'}`} aria-hidden="true" />
          {interacted ? <span>That’s live. Now picture it for whatever you’re stuck on.</span> : <span><strong>Try it:</strong> {demo.hint}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <LoginButtonSocial1 className="w-auto" label="Sign up to ask your own" disabled={signingIn} aria-busy={signingIn} onClick={onSignIn} />
          {!isLast && <Button variant="ghost" size="lg" onClick={() => scrollToId(`demo-${index + 1}`)}>
            Next example<ArrowDown />
          </Button>}
        </div>
      </div>
    </div>
  </section>;
}

export default function Landing({ onSignIn, signingIn, error }: LandingProps) {
  return <main className="landing">
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-4 md:px-6">
        <span className="flex items-center gap-2.5 text-xl font-bold"><MathLogo size={28} />veomath</span>
        <Button variant="outline" size="sm" disabled={signingIn} onClick={onSignIn}>Sign in</Button>
      </div>
    </header>

    <section className="landing-hero">
      <div className="mx-auto flex max-w-[760px] flex-col items-center gap-6 text-center">
        <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">Learn math <em className="font-normal">visually</em></h1>
        <p className="max-w-[560px] text-lg text-muted-foreground md:text-xl">
          Ask a math question. Get an interactive animation that explains it.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <LoginButtonSocial1 className="w-auto" label="Sign up with Google" disabled={signingIn} aria-busy={signingIn} onClick={onSignIn} />
          <Button variant="ghost" size="lg" onClick={() => scrollToId('demo-0')}>See examples<ArrowDown /></Button>
        </div>
        {error && <Alert variant="destructive" className="text-left"><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
      <button type="button" aria-label="Scroll to the first example" onClick={() => scrollToId('demo-0')} className="landing-scroll-cue">
        <ArrowDown className="size-5" />
      </button>
    </section>

    {LANDING_DEMOS.map((demo, index) => <DemoSection key={demo.id} demo={demo} index={index} total={LANDING_DEMOS.length} onSignIn={onSignIn} signingIn={signingIn} />)}

    <footer className="border-t border-border/40 py-10 text-center text-base text-muted-foreground">
      made by <a href="https://manoletre.com" target="_blank" rel="noopener noreferrer" className="text-foreground underline-offset-4 hover:underline">manoletre</a> <span role="img" aria-label="Colombia">🇨🇴</span>
    </footer>
  </main>;
}
