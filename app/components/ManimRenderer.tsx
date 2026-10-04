'use client';

import { useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api-fetch';

interface ManimRendererProps {
  code: string;
  renderKey: number;
  onError?: (code: string, error: string) => void;
  onSuccess?: (frame: string | null) => void;
  onRuntimeError?: (error: string) => void;
  onReady?: (exportKeys: string[]) => void;
  activitySessionId?: string;
  activitySlideIndex?: number;
}

export default function ManimRenderer({
  code,
  renderKey,
  onError,
  onSuccess,
  onRuntimeError,
  onReady,
  activitySessionId,
  activitySlideIndex = 0,
}: ManimRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activitySessionId) return;
    let visible = false;
    let foreground = !document.hidden;
    let lastViewed = performance.now();
    let viewedMilliseconds = 0;
    let pointer: { id: number; x: number; y: number; dragged: boolean } | null = null;
    const counts = { viewedSeconds: 0, clicks: 0, drags: 0, controlChanges: 0 };
    const updateViewed = () => {
      const now = performance.now();
      if (visible && foreground) viewedMilliseconds += now - lastViewed;
      lastViewed = now;
      const seconds = Math.floor(viewedMilliseconds / 1000);
      counts.viewedSeconds += seconds;
      viewedMilliseconds -= seconds * 1000;
    };
    const observer = new IntersectionObserver(entries => {
      updateViewed();
      visible = entries[0]?.intersectionRatio >= 0.25;
    }, { threshold: [0, 0.25] });
    observer.observe(container);
    const onPointerDown = (event: PointerEvent) => {
      counts.clicks++;
      if (event.target instanceof HTMLCanvasElement) {
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) {
        pointer.dragged = true;
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) return;
      if (pointer.dragged && event.type !== 'pointercancel') counts.drags++;
      pointer = null;
    };
    const onInput = () => { counts.controlChanges++; };
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('input', onInput);
    const flush = () => {
      updateViewed();
      if (!Object.values(counts).some(Boolean)) return;
      const batch = { ...counts };
      counts.viewedSeconds = counts.clicks = counts.drags = counts.controlChanges = 0;
      void apiFetch('/api/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ sessionId: activitySessionId, slideIndex: activitySlideIndex, ...batch }),
      }).catch(() => {});
    };
    const onVisibilityChange = () => {
      updateViewed();
      foreground = !document.hidden;
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    const timer = window.setInterval(flush, 30000);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('input', onInput);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [activitySessionId, activitySlideIndex]);

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
            container.textContent = errStr;
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
