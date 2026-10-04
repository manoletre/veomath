'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { IDLE_WAIT_SECONDS, keepSceneLive, patchManim } from '../components/manimRuntime';

declare global {
  interface Window {
    __animationReady: boolean;
    __animationErrors: string[];
    /** Error thrown by the generated code itself — the case where the app's ManimRenderer calls onError and auto-retries. */
    __animationFatalError?: string;
    /** Set by the eval runner via addInitScript, bypassing the in-memory code store. */
    __sandboxCode?: string;
    /** Instrumentation read by the eval runner. */
    __sandbox?: {
      scene: unknown;
      manim: unknown;
      playCount: number;
      draggables: unknown[];
      clickables: unknown[];
      hoverables: unknown[];
    };
  }
}

function SandboxContent() {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'running' | 'done' | 'error'>('loading');

  useEffect(() => {
    window.__animationReady = false;
    window.__animationErrors = [];

    const id = searchParams.get('id');
    const injectedCode = window.__sandboxCode;
    if (!id && !injectedCode) {
      window.__animationErrors.push('No code ID provided');
      window.__animationReady = true;
      setStatus('error');
      return;
    }

    let cancelled = false;

    function handleWindowError(e: ErrorEvent) {
      if (cancelled) return;
      const msg = e.message || String(e);
      if (!window.__animationErrors.includes(msg)) {
        window.__animationErrors.push(msg);
      }
    }
    function handleRejection(e: PromiseRejectionEvent) {
      if (cancelled) return;
      const msg = String(e.reason);
      if (!window.__animationErrors.includes(msg)) {
        window.__animationErrors.push(msg);
      }
    }
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleRejection);

    async function run() {
      try {
        let code = injectedCode;
        if (!code) {
          const res = await fetch(`/api/agentic/sandbox-code?id=${id}`);
          if (!res.ok) throw new Error(`Failed to fetch code: ${res.status}`);
          code = (await res.json()).code;
        }
        if (!code) throw new Error('No code returned');

        if (cancelled || !containerRef.current) return;

        setStatus('running');

        const manim = await import('manim-web');
        if (cancelled || !containerRef.current) return;

        const container = containerRef.current;
        container.innerHTML = '';

        patchManim(manim);
        const { Scene } = manim;
        const scene = new Scene(container, {
          width: 1280,
          height: 720,
          backgroundColor: '#000000',
        });
        keepSceneLive(scene);

        const instr = { scene, manim, playCount: 0, draggables: [] as unknown[], clickables: [] as unknown[], hoverables: [] as unknown[] };
        window.__sandbox = instr;

        const originalPlay = scene.play.bind(scene);
        scene.play = (...args: Parameters<typeof scene.play>) => {
          instr.playCount++;
          return originalPlay(...args);
        };
        const originalWait = scene.wait.bind(scene);
        scene.wait = (duration?: number) => {
          if ((duration ?? 0) >= IDLE_WAIT_SECONDS && !cancelled) {
            setStatus('done');
            window.__animationReady = true;
          }
          return originalWait(duration);
        };

        const instrumented = {
          ...manim,
          makeDraggable: (...args: Parameters<typeof manim.makeDraggable>) => {
            instr.draggables.push(args[0]);
            return manim.makeDraggable(...args);
          },
          makeClickable: (...args: Parameters<typeof manim.makeClickable>) => {
            instr.clickables.push(args[0]);
            return manim.makeClickable(...args);
          },
          makeHoverable: (...args: Parameters<typeof manim.makeHoverable>) => {
            instr.hoverables.push(args[0]);
            return manim.makeHoverable(...args);
          },
        };

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const exportKeys = Object.keys(instrumented).join(', ');
        const wrappedCode = `const { ${exportKeys} } = __manim;\n${code}`;
        const fn = new AsyncFunction('scene', '__manim', wrappedCode);

        await fn(scene, instrumented);

        if (!cancelled) {
          setStatus('done');
          window.__animationReady = true;
        }
      } catch (err) {
        if (!cancelled) {
          const msg = String(err);
          window.__animationFatalError = msg;
          window.__animationErrors.push(msg);
          window.__animationReady = true;
          setStatus('error');
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [searchParams]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{ width: 1280, height: 720, position: 'relative', background: '#000' }}
      />
      {status === 'loading' && (
        <div style={{ position: 'absolute', top: 10, left: 10, color: '#555', fontSize: 12 }}>
          Loading...
        </div>
      )}
    </div>
  );
}

export default function SandboxPage() {
  return (
    <Suspense
      fallback={
        <div style={{ width: '100vw', height: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
          Loading...
        </div>
      }
    >
      <SandboxContent />
    </Suspense>
  );
}
