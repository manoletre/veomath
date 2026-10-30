'use client';

import { ArrowDown, ArrowUp, Hand } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LoginButtonSocial1 } from '@/components/login-button-social-1';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LANDING_DEMOS, type LandingDemo } from '../lib/landing-demos';
import ManimRenderer from './ManimRenderer';
import MathLogo from './MathLogo';
import VisuallyWord from './VisuallyWord';

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

/** Index of the example section currently filling most of the scroll area, or -1 above the first. */
function useActiveExample(count: number) {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const sections = Array.from({ length: count }, (_, i) => document.getElementById(`demo-${i}`)).filter(el => el !== null);
    const hero = document.getElementById('landing-hero');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        setActive(entry.target === hero ? -1 : sections.indexOf(entry.target as HTMLElement));
      }
    }, { root: document.querySelector('.landing-main'), threshold: 0.5 });
    [hero, ...sections].forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [count]);
  return active;
}

function Credit() {
  return <>made by <a href="https://manoletre.com" target="_blank" rel="noopener noreferrer" className="text-foreground underline-offset-4 hover:underline">manoletre</a> <span role="img" aria-label="Colombia">🇨🇴</span></>;
}

export default function Landing({ onSignIn, signingIn, error }: LandingProps) {
  const active = useActiveExample(LANDING_DEMOS.length);

  return <div className="landing">
    <aside className="landing-rail">
      <span className="flex items-center gap-3 text-2xl font-bold md:text-[2rem]"><MathLogo size={32} />veomath</span>
      <Button variant="outline" size="sm" className="md:hidden" disabled={signingIn} onClick={onSignIn}>Sign in</Button>

      <div className="hidden flex-1 flex-col gap-10 md:flex">
        <p className="text-base text-muted-foreground">A math tutor that answers with animations you can interact with.</p>
        <LoginButtonSocial1 label="Sign up with Google" disabled={signingIn} aria-busy={signingIn} onClick={onSignIn} />
        <nav aria-label="Examples" className="flex flex-col gap-1">
          <p className="mb-2 text-sm text-muted-foreground">Examples</p>
          {LANDING_DEMOS.map((demo, index) => <button key={demo.id} type="button" aria-current={active === index ? 'true' : undefined}
            className="landing-rail-link" onClick={() => scrollToId(`demo-${index}`)}>
            <span className="tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>{demo.title}
          </button>)}
        </nav>
        <p className="mt-auto text-sm text-muted-foreground"><Credit /></p>
      </div>
    </aside>

    <main className="landing-main">
      <section id="landing-hero" className="landing-hero">
        <div className="flex w-full max-w-[960px] flex-col items-start gap-8">
          <h1 className="text-[clamp(3.5rem,11vw,9rem)] font-bold leading-[0.98] tracking-tight">Learn math<br /><VisuallyWord>visually</VisuallyWord></h1>
          <p className="max-w-[520px] text-lg text-muted-foreground md:text-xl">
            Ask a math question. Get an interactive animation that explains it.
          </p>
          <Button variant="outline" size="lg" onClick={() => scrollToId('demo-0')}>See it in action<ArrowDown /></Button>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
      </section>

      {LANDING_DEMOS.map((demo, index) => <DemoSection key={demo.id} demo={demo} index={index} total={LANDING_DEMOS.length} onSignIn={onSignIn} signingIn={signingIn} />)}

      <footer className="border-t border-border/40 py-10 text-center text-base text-muted-foreground md:hidden">
        <Credit />
      </footer>
    </main>
  </div>;
}
