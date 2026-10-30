'use client';

import { useEffect, useRef, useState } from 'react';

// The hero's "visually": five math figures are drawn, break into dots, and the dots fly into the
// letterforms and stay there. The dots lean slightly toward the cursor, hovering pushes them around,
// and clicking rebuilds the word.
// Plain 2D canvas so the landing page loads no extra code; the real text stays underneath for screen readers.

type Kind = 'circle' | 'triangle' | 'wave' | 'square' | 'spiral';
type Point = [number, number];

// Saturated, bright hues (the manim palette's hues, pushed) so the word pops on black.
const FIGURES: { kind: Kind; color: string }[] = [
  { kind: 'circle', color: '#1FD2FF' },
  { kind: 'triangle', color: '#FFD60A' },
  { kind: 'wave', color: '#39F07A' },
  { kind: 'square', color: '#FF4D5E' },
  { kind: 'spiral', color: '#C77DFF' },
];

const DRAW_STAGGER = 110;
const DRAW_MS = 650;
const MOVE_AT = 1150;
const MOVE_SPREAD = 450;
const MOVE_MS = 950;
const SETTLED_AT = MOVE_AT + MOVE_SPREAD + MOVE_MS;
const MAX_DOTS = 6000;
/** How far behind the pen, as a fraction of the figure, a dot takes to grow in. */
const GROW_SPAN = 1 / 6;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
const easeOut = (x: number) => 1 - (1 - x) ** 3;

function polygonAt(corners: Point[], t: number): Point {
  const s = (t % 1) * corners.length;
  const i = Math.floor(s);
  const f = s - i;
  const a = corners[i];
  const b = corners[(i + 1) % corners.length];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function regular(cx: number, cy: number, r: number, sides: number, start: number): Point[] {
  return Array.from({ length: sides }, (_, k) => {
    const a = start + k * 2 * Math.PI / sides;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** Point at parameter t ∈ [0, 1] along a figure centered on (cx, cy). Canvas y points down. */
function figureAt(kind: Kind, cx: number, cy: number, r: number, t: number): Point {
  switch (kind) {
    case 'circle': {
      const a = -Math.PI / 2 + 2 * Math.PI * t;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    case 'triangle': return polygonAt(regular(cx, cy + r * 0.15, r * 1.1, 3, -Math.PI / 2), t);
    case 'square': return polygonAt(regular(cx, cy, r * 1.05, 4, -Math.PI / 4), t);
    case 'wave': return [cx + r * 1.3 * (2 * t - 1), cy - r * 0.7 * Math.sin(4 * Math.PI * t)];
    case 'spiral': {
      const a = -Math.PI / 2 + 4 * Math.PI * t;
      const rr = r * (0.12 + 0.88 * t);
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    }
  }
}

/** Adds one mark to the current path, so each figure's marks fill or stroke in a single draw call. */
function addMark(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number, s: number, rot: number) {
  switch (kind) {
    case 'circle':
      ctx.moveTo(x + s, y);
      ctx.arc(x, y, s, 0, 2 * Math.PI);
      return;
    case 'triangle':
    case 'square': {
      const n = kind === 'triangle' ? 3 : 4;
      const r = kind === 'triangle' ? s * 1.35 : s * 1.2;
      for (let k = 0; k < n; k++) {
        const a = rot - Math.PI / 2 + k * 2 * Math.PI / n + (n === 4 ? Math.PI / 4 : 0);
        ctx[k ? 'lineTo' : 'moveTo'](x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
      return;
    }
    case 'wave': {
      // A plus sign.
      const c = Math.cos(rot), sn = Math.sin(rot), l = s * 1.15;
      ctx.moveTo(x - l * c, y - l * sn); ctx.lineTo(x + l * c, y + l * sn);
      ctx.moveTo(x + l * sn, y - l * c); ctx.lineTo(x - l * sn, y + l * c);
      return;
    }
    case 'spiral':
      ctx.moveTo(x + s * 0.85, y);
      ctx.arc(x, y, s * 0.85, 0, 2 * Math.PI);
  }
}

/** Stroked marks need a line width; filled ones ignore it. */
const STROKED: Partial<Record<Kind, number>> = { wave: 0.6, spiral: 0.5 };

interface Dot {
  figure: number;
  /** Where along its figure the dot starts, 0 to 1; it appears once the tracing pen passes it. */
  along: number;
  from: Point;
  to: Point;
  delay: number;
  bend: number;
  spin: number;
  /** Hover displacement, its velocity, and the extra spin it gave the mark. */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  rot: number;
}

interface Scene {
  /** Draws the build animation at t ms (settled from SETTLED_AT on), plus any hover displacement. */
  draw: (t: number) => void;
  /**
   * Advances the physics one frame: dots lean toward `cursor` (client coordinates, anywhere on the page)
   * and are pushed away from `hover` (canvas coordinates, only over the word). Returns whether any dot is still moving.
   */
  step: (hover: Point | null, cursor: Point | null) => boolean;
  /** Client coordinates to canvas coordinates. */
  toLocal: (clientX: number, clientY: number) => Point;
}

/** Lays the canvas over the word and samples where every dot starts and lands. */
function buildScene(word: HTMLElement, canvas: HTMLCanvasElement): Scene | null {
  const rect = word.getBoundingClientRect();
  const style = getComputedStyle(word);
  const fontSize = parseFloat(style.fontSize);
  if (!rect.width || !fontSize) return null;

  const pad = Math.round(fontSize * 0.35);
  const width = rect.width + pad * 2;
  const height = rect.height + pad * 2;
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  // Sample the letterforms on an offscreen canvas laid out exactly like the DOM text.
  const probe = document.createElement('canvas');
  probe.width = Math.ceil(width);
  probe.height = Math.ceil(height);
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!pctx) return null;
  pctx.font = font;
  if ('letterSpacing' in pctx) pctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  const ascent = pctx.measureText(word.textContent ?? '').fontBoundingBoxAscent || fontSize * 0.9;
  pctx.fillStyle = '#fff';
  pctx.fillText(word.textContent ?? '', pad, pad + ascent);
  const pixels = pctx.getImageData(0, 0, probe.width, probe.height).data;

  const step = Math.max(1.6, fontSize / 50);
  let targets: Point[] = [];
  for (let row = 0, y = step / 2; y < probe.height; row++, y += step * 0.87) {
    for (let x = (row % 2) * step / 2; x < probe.width; x += step) {
      if (pixels[(Math.floor(y) * probe.width + Math.floor(x)) * 4 + 3] > 140) targets.push([x, y]);
    }
  }
  if (targets.length < 20) return null;
  if (targets.length > MAX_DOTS) {
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }
    targets.length = MAX_DOTS;
  }
  targets = targets.sort((a, b) => a[0] - b[0]);

  // Each figure sits over a fifth of the word and feeds the letters underneath it.
  const radius = Math.min(rect.height * 0.4, rect.width / FIGURES.length * 0.62);
  const centerY = pad + rect.height * 0.5;
  const figures = FIGURES.map((figure, i) => ({ ...figure, cx: pad + rect.width * (i + 0.5) / FIGURES.length, cy: centerY }));
  const dots: Dot[] = [];
  const ranges: [number, number][] = [];
  const chunk = Math.ceil(targets.length / figures.length);
  figures.forEach((figure, i) => {
    const group = targets.slice(i * chunk, (i + 1) * chunk);
    ranges[i] = [dots.length, dots.length + group.length];
    if (!group.length) return;
    const gx = group.reduce((s, p) => s + p[0], 0) / group.length;
    const gy = group.reduce((s, p) => s + p[1], 0) / group.length;
    // Order targets the way the figure is traced so dots flow without crossing much.
    const order = (p: Point) => figure.kind === 'wave' ? p[0]
      : figure.kind === 'spiral' ? Math.hypot(p[0] - gx, p[1] - gy)
        : (Math.atan2(p[1] - gy, p[0] - gx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    group.sort((a, b) => order(a) - order(b)).forEach((to, k) => dots.push({
      figure: i,
      along: k / group.length,
      from: figureAt(figure.kind, figure.cx, figure.cy, radius, k / group.length),
      to,
      delay: MOVE_SPREAD * (0.55 * i / figures.length + 0.45 * Math.random()),
      bend: (Math.random() - 0.5) * rect.height * 0.5,
      spin: (Math.random() - 0.5) * 4 * Math.PI,
      ox: 0, oy: 0, vx: 0, vy: 0, rot: 0,
    }));
  });

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  // The em's content box overflows the tighter line box of its wrapper, which positions the canvas.
  const host = canvas.parentElement!.getBoundingClientRect();
  Object.assign(canvas.style, { left: `${rect.left - host.left - pad}px`, top: `${rect.top - host.top - pad}px`, width: `${width}px`, height: `${height}px` });
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const markSize = step * 0.46;
  const reach = fontSize * 0.4;
  const push = fontSize / 75;
  const maxLean = fontSize * 0.06;

  const step_ = (hover: Point | null, cursor: Point | null) => {
    let leanX = 0, leanY = 0;
    if (cursor) {
      const box = canvas.getBoundingClientRect();
      const dx = cursor[0] - (box.left + box.width / 2);
      const dy = cursor[1] - (box.top + box.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const lean = maxLean * Math.min(1, d / 600);
      leanX = dx / d * lean;
      leanY = dy / d * lean;
    }
    let moving = false;
    for (const dot of dots) {
      if (hover) {
        const dx = dot.to[0] + dot.ox - hover[0];
        const dy = dot.to[1] + dot.oy - hover[1];
        const d = Math.hypot(dx, dy) || 1;
        if (d < reach) {
          const f = push * (1 - d / reach) ** 2;
          dot.vx += dx / d * f;
          dot.vy += dy / d * f;
        }
        // A little shimmer everywhere while the cursor is on the word.
        dot.vx += (Math.random() - 0.5) * 0.12;
        dot.vy += (Math.random() - 0.5) * 0.12;
      }
      // Spring toward the lean position rather than the resting one.
      // Every dot shares one spring, so the word leans as a single block.
      const tx = leanX, ty = leanY;
      dot.vx = (dot.vx - (dot.ox - tx) * 0.06) * 0.86;
      dot.vy = (dot.vy - (dot.oy - ty) * 0.06) * 0.86;
      dot.ox += dot.vx;
      dot.oy += dot.vy;
      dot.rot += (dot.vx - dot.vy) * 0.08;
      if (Math.abs(dot.vx) + Math.abs(dot.vy) > 0.02 || Math.abs(dot.ox - tx) + Math.abs(dot.oy - ty) > 0.2) moving = true;
      else { dot.ox = tx; dot.oy = ty; dot.vx = dot.vy = 0; }
    }
    return moving;
  };

  const traced = (i: number, t: number) => easeInOut(clamp01((t - i * DRAW_STAGGER) / DRAW_MS));

  const draw = (t: number) => {
    ctx.clearRect(0, 0, width, height);

    // 1. Each figure is traced in, like manim's Create, then fades once its dots have taken over.
    const strokeFade = 1 - clamp01((t - MOVE_AT + 150) / 300);
    if (strokeFade > 0) {
      ctx.lineWidth = Math.max(1.5, fontSize / 55);
      ctx.globalAlpha = strokeFade;
      figures.forEach((figure, i) => {
        const progress = traced(i, t);
        if (!progress) return;
        ctx.strokeStyle = figure.color;
        ctx.beginPath();
        const samples = Math.ceil(120 * progress);
        for (let s = 0; s <= samples; s++) ctx.lineTo(...figureAt(figure.kind, figure.cx, figure.cy, radius, progress * s / samples));
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // 2. Dots grow in just behind the pen, then fly into the letters. One path per figure keeps frames cheap.
    figures.forEach((figure, i) => {
      const progress = traced(i, t);
      if (!progress) return;
      ctx.beginPath();
      for (let d = ranges[i][0]; d < ranges[i][1]; d++) {
        const dot = dots[d];
        // Stretched so the last dots on the figure still finish growing when the pen does.
        const grow = easeOut(clamp01((progress * (1 + GROW_SPAN) - dot.along) / GROW_SPAN));
        if (!grow) continue;
        const p = easeInOut(clamp01((t - MOVE_AT - dot.delay) / MOVE_MS));
        const arc = Math.sin(Math.PI * p) * dot.bend;
        const dx = dot.to[0] - dot.from[0], dy = dot.to[1] - dot.from[1];
        const len = Math.hypot(dx, dy) || 1;
        addMark(ctx, figure.kind,
          dot.from[0] + dx * p - dy / len * arc + dot.ox,
          dot.from[1] + dy * p + dx / len * arc + dot.oy,
          markSize * grow, dot.spin * (1 - p) + dot.rot);
      }
      const stroked = STROKED[figure.kind];
      if (stroked) {
        ctx.lineWidth = markSize * stroked;
        ctx.strokeStyle = figure.color;
        ctx.stroke();
      } else {
        ctx.fillStyle = figure.color;
        ctx.fill();
      }
    });
  };

  return {
    draw,
    step: step_,
    toLocal: (clientX, clientY) => {
      const box = canvas.getBoundingClientRect();
      return [clientX - box.left, clientY - box.top];
    },
  };
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function VisuallyWord({ children }: { children: string }) {
  const wordRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controls = useRef<{ replay: () => void; point: (pointer: Point | null) => void } | null>(null);
  // The landing page only renders in the browser (after the auth check), so window is available here.
  const [mode, setMode] = useState<'canvas' | 'text'>(() => reducedMotion() ? 'text' : 'canvas');

  useEffect(() => {
    if (reducedMotion()) return;
    let scene: Scene | null = null;
    let start = 0;
    let raf = 0;
    let hover: Point | null = null;
    let cursor: Point | null = null;
    let disposed = false;

    const tick = (now: number) => {
      raf = 0;
      if (!scene || disposed) return;
      const t = now - start;
      // The cursor only takes effect once the word has formed; afterwards the spring eases it in.
      const building = t < SETTLED_AT;
      const moving = scene.step(building ? null : hover, building ? null : cursor);
      scene.draw(t);
      if (t < SETTLED_AT || moving || hover) raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };
    /** Rebuilds the dots for the current layout; `settled` skips straight to the finished word. */
    const build = (settled: boolean) => {
      const next = wordRef.current && canvasRef.current && buildScene(wordRef.current, canvasRef.current);
      if (!next) return setMode('text');
      scene = next;
      start = performance.now() - (settled ? SETTLED_AT : 0);
      wake();
    };

    controls.current = {
      replay: () => build(false),
      point: next => {
        hover = next && scene ? scene.toLocal(...next) : null;
        wake();
      },
    };

    // The dots are laid out from the text's position, so redo them when the width changes.
    let lastWidth = window.innerWidth;
    let resizeTimer = 0;
    const onResize = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => build(true), 150);
    };
    window.addEventListener('resize', onResize);

    // Follow the cursor anywhere on the page, but only bother while the word is on screen.
    const onPointerMove = (event: PointerEvent) => {
      cursor = [event.clientX, event.clientY];
      const box = canvasRef.current?.getBoundingClientRect();
      if (box && box.bottom > 0 && box.top < window.innerHeight) wake();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      cursor = null;
      wake();
    };
    window.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerout', onPointerOut);

    const word = wordRef.current;
    const font = word ? getComputedStyle(word) : null;
    (font ? document.fonts.load(`${font.fontStyle} 400 1em ${font.fontFamily}`) : Promise.resolve())
      .catch(() => {})
      .then(() => { if (!disposed) build(false); });

    return () => {
      disposed = true;
      controls.current = null;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerOut);
    };
  }, []);

  if (mode === 'text') return <em className="font-normal">{children}</em>;

  return <button type="button" className="visually-word"
    onClick={() => controls.current?.replay()}
    onPointerMove={event => controls.current?.point([event.clientX, event.clientY])}
    onPointerLeave={() => controls.current?.point(null)}>
    <em ref={wordRef} style={{ color: 'transparent' }}>{children}</em>
    <canvas ref={canvasRef} aria-hidden="true" />
  </button>;
}
