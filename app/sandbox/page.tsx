'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

declare global {
  interface Window {
    __animationReady: boolean;
    __animationErrors: string[];
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
    if (!id) {
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
    window.addEventListener('error', handleWindowError);

    async function run() {
      try {
        const res = await fetch(`/api/agentic/sandbox-code?id=${id}`);
        if (!res.ok) throw new Error(`Failed to fetch code: ${res.status}`);
        const { code } = await res.json();
        if (!code) throw new Error('No code returned');

        if (cancelled || !containerRef.current) return;

        setStatus('running');

        const manim = await import('manim-web');
        if (cancelled || !containerRef.current) return;

        const container = containerRef.current;
        container.innerHTML = '';

        const { Scene } = manim;
        const scene = new Scene(container, {
          width: 1280,
          height: 720,
          backgroundColor: '#000000',
        });

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const exportKeys = Object.keys(manim).join(', ');
        const wrappedCode = `const { ${exportKeys} } = __manim;\n${code}`;
        const fn = new AsyncFunction('scene', '__manim', wrappedCode);

        await fn(scene, manim);

        if (!cancelled) {
          setStatus('done');
          window.__animationReady = true;
        }
      } catch (err) {
        if (!cancelled) {
          const msg = String(err);
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
