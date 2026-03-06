'use client';

import { useEffect, useRef } from 'react';

interface ManimRendererProps {
  code: string;
  renderKey: number;
  onError?: (code: string, error: string) => void;
  onSuccess?: (frame: string | null) => void;
  onRuntimeError?: (error: string) => void;
  onReady?: (exportKeys: string[]) => void;
}

export default function ManimRenderer({
  code,
  renderKey,
  onError,
  onSuccess,
  onRuntimeError,
  onReady,
}: ManimRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let cancelled = false;
    // Track which runtime error messages we've already reported so we don't spam
    const reportedErrors = new Set<string>();

    // Catch unhandled errors thrown inside the manim-web animation loop
    // (e.g. updater callbacks calling non-existent methods like putStartAndEndOn)
    function handleWindowError(e: ErrorEvent) {
      if (cancelled) return;
      const msg = e.message || String(e);
      if (!reportedErrors.has(msg)) {
        reportedErrors.add(msg);
        onRuntimeError?.(msg);
      }
    }
    window.addEventListener('error', handleWindowError);

    async function run() {
      try {
        const manim = await import('manim-web');
        if (cancelled || !container) return;

        onReady?.(Object.keys(manim));

        // Clear previous scene
        container.innerHTML = '';

        const { Scene } = manim;

        // Enforce 16:9 aspect ratio so coordinate bounds are always 14×8
        const containerW = container.clientWidth || 800;
        const containerH = container.clientHeight || 600;
        const aspect = 16 / 9;
        let canvasW = containerW;
        let canvasH = Math.round(containerW / aspect);
        if (canvasH > containerH) {
          canvasH = containerH;
          canvasW = Math.round(containerH * aspect);
        }

        const scene = new Scene(container, {
          width: canvasW,
          height: canvasH,
          backgroundColor: '#000000',
        });

        // Center the canvas using explicit pixel offsets (no CSS transform)
        // so that offsetLeft/offsetTop match the visual position — required for
        // makeDraggable hit-testing to work correctly.
        const cv = container.querySelector('canvas');
        if (cv) {
          const offsetX = Math.round((containerW - canvasW) / 2);
          const offsetY = Math.round((containerH - canvasH) / 2);
          cv.style.position = 'absolute';
          cv.style.left = `${offsetX}px`;
          cv.style.top = `${offsetY}px`;
        }

        // Build the async function with all manim exports in scope
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const exportKeys = Object.keys(manim).join(', ');
        const wrappedCode = `const { ${exportKeys} } = __manim;\n${code}`;
        const fn = new AsyncFunction('scene', '__manim', wrappedCode);

        cleanupRef.current = () => {
          cancelled = true;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((scene as any).renderer?.stop) (scene as any).renderer.stop();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((scene as any).destroy) (scene as any).destroy();
          } catch {}
          container.innerHTML = '';
        };

        await fn(scene, manim);

        if (!cancelled) {
          let frame: string | null = null;
          try {
            const canvas = container.querySelector('canvas');
            if (canvas) frame = canvas.toDataURL('image/jpeg', 0.7);
          } catch {}
          onSuccess?.(frame);
        }
      } catch (err) {
        if (!cancelled) {
          const errStr = String(err);
          console.error('ManimRenderer error:', err);
          if (container) {
            container.innerHTML = `<div style="color:#ef4444;padding:16px;font-family:monospace;font-size:12px;white-space:pre-wrap;">${errStr}</div>`;
          }
          onError?.(code, errStr);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      window.removeEventListener('error', handleWindowError);
      cleanupRef.current();
    };
  // renderKey forces full remount when code changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: '#000', position: 'relative', overflow: 'hidden', touchAction: 'none' }}
    />
  );
}
