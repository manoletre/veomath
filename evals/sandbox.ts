// Renders generated manim-web code in the /sandbox page (headless Chromium) and
// runs deterministic checks — no LLM involved.

import { chromium, type Browser, type Page } from 'playwright';
import { CRITICAL_CHECKS, type CheckId, type CheckResult, type InteractionKind, type InteractionResult } from './types';

const VIEWPORT = { width: 1280, height: 720 };
const READY_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1_000;
const MAX_SLIDERS = 6;
const MAX_BUTTONS = 4;
/** Per kind (draggables, clickables, hoverables). */
const MAX_POINTER_TARGETS = 4;

const NON_BLANK_MIN_FRACTION = 0.001;
/** ~180 px at 1280×720 — a small dot moving 70 px changes about this much. */
const PER_INTERACTION_MIN_CHANGE = 0.0002;
const OVERLAP_MIN_RATIO = 0.25;

export interface RenderOutcome {
  durationMs: number;
  completed: boolean;
  /** Set when the code itself threw — the app auto-retries once in this case. */
  fatalError: string | null;
  errors: string[];
  interactionErrors: string[];
  playCount: number;
  controls: { sliders: number; buttons: number; checkboxes: number };
  draggables: number;
  clickables: number;
  hoverables: number;
  nonBlankFraction: number;
  outOfFrame: string[];
  textOverlaps: string[];
  rawLatex: string[];
  /** Each control exercised, measured on its own. */
  interactions: InteractionResult[];
  idleChange: number;
  finalJpeg: Buffer | null;
  interactedJpeg: Buffer | null;
}

interface SceneAnalysis {
  playCount: number;
  controls: { sliders: number; buttons: number; checkboxes: number };
  draggables: number;
  clickables: number;
  hoverables: number;
  outOfFrame: string[];
  textOverlaps: string[];
  rawLatex: string[];
}

/** Headless Chromium has no GPU; SwiftShader gives manim-web (three.js) a software WebGL context. */
export function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

export async function renderAndAnalyze(browser: Browser, baseUrl: string, code: string): Promise<RenderOutcome> {
  const started = Date.now();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  try {
    // tsx/esbuild wraps named functions in __name(); functions serialized into the page need the shim.
    await page.addInitScript({ content: 'globalThis.__name = (fn) => fn;' });
    await page.addInitScript((c) => { window.__sandboxCode = c; }, code);
    await page.goto(`${baseUrl}/sandbox?eval=1`, { waitUntil: 'domcontentloaded' });
    // Hide the Next.js dev indicator so it doesn't show up in screenshots / pixel stats.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

    let completed = true;
    try {
      await page.waitForFunction(() => window.__animationReady === true, null, { timeout: READY_TIMEOUT_MS });
    } catch {
      completed = false;
    }
    await page.waitForTimeout(SETTLE_MS);

    const errors = await getErrors(page);
    const fatalError = await page.evaluate(() => window.__animationFatalError ?? null);
    const finalShot = await screenshot(page);
    await page.waitForTimeout(500);
    const idleShot = await screenshot(page);

    const analysis = await page.evaluate(analyzeScene, { width: VIEWPORT.width, height: VIEWPORT.height, overlapMin: OVERLAP_MIN_RATIO });

    const interactions = await interact(page);
    await page.waitForTimeout(800);
    const interactedShot = await screenshot(page);
    const interactionErrors = (await getErrors(page)).filter((e) => !errors.includes(e));

    const pixels = await page.evaluate(comparePixels, {
      final: finalShot.toString('base64'),
      idle: idleShot.toString('base64'),
      interacted: interactedShot.toString('base64'),
    });

    return {
      durationMs: Date.now() - started,
      completed,
      fatalError,
      errors,
      interactionErrors,
      playCount: analysis.playCount,
      controls: analysis.controls,
      draggables: analysis.draggables,
      clickables: analysis.clickables,
      hoverables: analysis.hoverables,
      nonBlankFraction: pixels.nonBlank,
      outOfFrame: analysis.outOfFrame,
      textOverlaps: analysis.textOverlaps,
      rawLatex: analysis.rawLatex,
      interactions,
      idleChange: pixels.idleChange,
      finalJpeg: Buffer.from(pixels.finalThumb, 'base64'),
      interactedJpeg: interactions.length > 0 ? Buffer.from(pixels.interactedThumb, 'base64') : null,
    };
  } finally {
    await context.close();
  }
}

export function computeChecks(code: string | null, r: RenderOutcome | null): Record<CheckId, CheckResult> {
  if (!code || !r) {
    return {
      generated: { pass: false, detail: 'Request failed or the response was not valid JSON with manimCode' },
      runs: { pass: false },
      completes: { pass: false },
      nonBlank: { pass: false },
      inFrame: { pass: false },
      noTextOverlap: { pass: false },
      noRawLatex: { pass: false },
      interactive: { pass: false },
      respondsToInteraction: { pass: null },
      canvasInteraction: { pass: false },
      stableUnderInteraction: { pass: null },
    };
  }

  const interactiveCount = r.controls.sliders + r.controls.buttons + r.controls.checkboxes + r.draggables + r.clickables + r.hoverables;
  // Buttons are listed but not required to respond: "Reset" or "n = 52" can legitimately be a no-op.
  const measured = r.interactions.filter((i) => i.kind !== 'button');
  const pointer = r.interactions.filter((i) => i.kind === 'drag' || i.kind === 'click');
  const describe = (xs: InteractionResult[]) =>
    xs.map((i) => `${i.responded ? '✓' : '✗'} ${i.kind} ${i.label} — ${(i.change * 100).toFixed(2)}% changed`).join('\n');

  return {
    generated: { pass: true },
    runs: { pass: r.errors.length === 0, detail: r.errors.join('\n') || undefined },
    completes: { pass: r.completed, detail: r.completed ? undefined : `Did not reach the final scene.wait() within ${READY_TIMEOUT_MS / 1000}s` },
    nonBlank: { pass: r.nonBlankFraction >= NON_BLANK_MIN_FRACTION, detail: `${(r.nonBlankFraction * 100).toFixed(2)}% non-background pixels` },
    inFrame: { pass: r.outOfFrame.length === 0, detail: r.outOfFrame.join('\n') || undefined },
    noTextOverlap: { pass: r.textOverlaps.length === 0, detail: r.textOverlaps.join('\n') || undefined },
    noRawLatex: { pass: r.rawLatex.length === 0, detail: r.rawLatex.join('\n') || undefined },
    interactive: {
      pass: interactiveCount > 0,
      detail: `sliders=${r.controls.sliders} buttons=${r.controls.buttons} checkboxes=${r.controls.checkboxes} draggables=${r.draggables} clickables=${r.clickables} hoverables=${r.hoverables}`,
    },
    respondsToInteraction: measured.length === 0
      ? { pass: null, detail: 'No sliders, checkboxes or interactive mobjects to exercise' }
      : { pass: measured.every((i) => i.responded), detail: describe(r.interactions) },
    canvasInteraction: pointer.length === 0
      ? { pass: false, detail: 'No draggable or clickable mobjects — the scene only responds to panel controls' }
      : { pass: pointer.some((i) => i.responded), detail: describe(pointer) },
    stableUnderInteraction: r.interactions.length === 0
      ? { pass: null }
      : { pass: r.interactionErrors.length === 0, detail: r.interactionErrors.join('\n') || undefined },
  };
}

export function scoreChecks(checks: Record<CheckId, CheckResult>): number {
  if (CRITICAL_CHECKS.some((id) => checks[id].pass === false)) return 0;
  const applicable = Object.values(checks).filter((c) => c.pass !== null);
  return applicable.filter((c) => c.pass).length / applicable.length;
}

async function getErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__animationErrors || [])]);
}

async function screenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: 'jpeg', quality: 85, clip: { x: 0, y: 0, ...VIEWPORT } });
}

/** Screenshot with the Controls panel masked, so a moving slider thumb doesn't count as the scene responding. */
async function canvasShot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...VIEWPORT }, mask: [page.locator('.manimweb-controls')], maskColor: '#000000' });
}

/**
 * Exercises every control one at a time and measures each on its own, so one working slider can't mask
 * a dead drag or an invisible hover. Pointer targets are located right before each action because
 * earlier interactions may have moved them.
 */
async function interact(page: Page): Promise<InteractionResult[]> {
  const results: InteractionResult[] = [];

  let before = await canvasShot(page);
  await page.waitForTimeout(400);
  const settled = await canvasShot(page);
  const idle = await page.evaluate(pixelChange, { a: before.toString('base64'), b: settled.toString('base64') });
  const threshold = Math.max(PER_INTERACTION_MIN_CHANGE, idle * 1.5 + 0.0001);
  before = settled;

  const measure = async (settleMs: number) => {
    await page.waitForTimeout(settleMs);
    const after = await canvasShot(page);
    const change = await page.evaluate(pixelChange, { a: before.toString('base64'), b: after.toString('base64') });
    before = after;
    return change;
  };
  const record = async (kind: InteractionKind, label: string, settleMs = 400) => {
    const change = await measure(settleMs);
    results.push({ kind, label, change, responded: change >= threshold });
  };
  const resync = async () => {
    await page.waitForTimeout(300);
    before = await canvasShot(page);
  };

  const sliders = (await page.$$('.manimweb-controls input[type="range"]')).slice(0, MAX_SLIDERS);
  for (const slider of sliders) {
    try {
      const label = await slider.evaluate((el: HTMLInputElement) => {
        const min = parseFloat(el.min || '0');
        const max = parseFloat(el.max || '100');
        const cur = parseFloat(el.value);
        // Move toward whichever end is further away so the change is large.
        const target = cur < (min + max) / 2 ? min + (max - min) * 0.85 : min + (max - min) * 0.15;
        el.value = String(target);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.closest('div')?.querySelector('span')?.textContent ?? 'slider';
      });
      await record('slider', `"${label.slice(0, 40)}"`);
    } catch {}
  }

  for (const box of await page.$$('.manimweb-controls input[type="checkbox"]')) {
    try {
      const label = await box.evaluate((el: HTMLInputElement) => {
        el.click();
        return el.closest('label')?.textContent?.trim() ?? 'checkbox';
      });
      await record('checkbox', `"${label.slice(0, 40)}"`);
    } catch {}
  }

  const pointerAction = async (list: 'hoverables' | 'clickables' | 'draggables', kind: InteractionKind) => {
    const count = await page.evaluate((l) => (window.__sandbox?.[l] as unknown[] | undefined)?.length ?? 0, list);
    for (let i = 0; i < Math.min(count, MAX_POINTER_TARGETS); i++) {
      const target = await page.evaluate(locateTarget, { list, index: i, width: VIEWPORT.width, height: VIEWPORT.height });
      if (!target) continue;
      const [x, y] = target.point;
      const label = target.inScene ? target.label : `${target.label} (no longer in the scene)`;
      try {
        if (kind === 'hover') {
          await page.mouse.move(x, y, { steps: 3 });
          await record('hover', label);
          await page.mouse.move(2, 2, { steps: 3 });
          await resync();
        } else if (kind === 'click') {
          await page.mouse.click(x, y);
          await record('click', label, 900);
        } else {
          const dragBy = async (fromX: number, fromY: number, dx: number, dy: number) => {
            await page.mouse.move(fromX, fromY);
            await page.mouse.down();
            await page.mouse.move(fromX + dx, fromY + dy, { steps: 8 });
            await page.mouse.up();
            return measure(400);
          };
          let change = await dragBy(x, y, 70, -50);
          if (change < threshold) {
            // The handle may already sit at a limit (clamped, or moved there by an earlier control): try the other way.
            const moved = await page.evaluate(locateTarget, { list, index: i, width: VIEWPORT.width, height: VIEWPORT.height });
            const [x2, y2] = moved?.point ?? [x, y];
            change = Math.max(change, await dragBy(x2, y2, -70, 50));
          }
          results.push({ kind: 'drag', label, change, responded: change >= threshold });
        }
      } catch {}
    }
  };
  // Drags before clicks and buttons, so "Reset" and preset controls have a changed state to act on.
  await pointerAction('hoverables', 'hover');
  await pointerAction('draggables', 'drag');
  await pointerAction('clickables', 'click');

  for (const button of (await page.$$('.manimweb-controls button')).slice(0, MAX_BUTTONS)) {
    try {
      const label = (await button.textContent())?.trim() ?? 'button';
      await button.click();
      await record('button', `"${label.slice(0, 40)}"`, 900);
    } catch {}
  }

  return results;
}

// ---- Functions below run inside the browser page (serialized by Playwright) ----

function analyzeScene({ width, height, overlapMin }: { width: number; height: number; overlapMin: number }): SceneAnalysis {
  type Bounds = { min: { x: number; y: number }; max: { x: number; y: number } };
  type Mob = {
    children?: Mob[];
    getBounds?: () => Bounds;
    getCenter?: () => number[];
    getText?: () => string;
    getLatex?: () => string;
    _canvas?: HTMLCanvasElement | null;
    _renderState?: { canvas?: HTMLCanvasElement | null };
  };
  type Ctor = new (...args: never[]) => unknown;

  const sb = window.__sandbox;
  const controlsCount = {
    sliders: document.querySelectorAll('.manimweb-controls input[type="range"]').length,
    buttons: document.querySelectorAll('.manimweb-controls button').length,
    checkboxes: document.querySelectorAll('.manimweb-controls input[type="checkbox"]').length,
  };
  if (!sb) {
    return { playCount: 0, controls: controlsCount, draggables: 0, clickables: 0, hoverables: 0, outOfFrame: [], textOverlaps: [], rawLatex: [] };
  }

  const M = sb.manim as Record<string, Ctor | undefined>;
  const scene = sb.scene as { mobjects: Iterable<Mob>; camera?: { frameWidth?: number; frameHeight?: number } };
  const frameW = scene.camera?.frameWidth ?? 14;
  const frameH = scene.camera?.frameHeight ?? (frameW * height) / width;
  const TOL = 0.1;

  const TEXT_TYPES = ['Tex', 'MathTex', 'MarkupText', 'Paragraph', 'DecimalNumber', 'Integer', 'Text'];
  const NAMED_TYPES = [...TEXT_TYPES, 'NumberPlane', 'Axes', 'NumberLine', 'FunctionGraph', 'ParametricFunction', 'Arrow', 'Line', 'Dot', 'Circle', 'Square', 'Rectangle', 'Polygon', 'VGroup', 'Group'];
  const isA = (m: Mob, name: string) => {
    const C = M[name];
    return typeof C === 'function' && m instanceof C;
  };
  const typeName = (m: Mob) => NAMED_TYPES.find((n) => isA(m, n)) ?? (m as object).constructor?.name ?? 'Mobject';
  const isText = (m: Mob) => TEXT_TYPES.some((n) => isA(m, n));
  const label = (m: Mob) => {
    const content = m.getLatex?.() ?? m.getText?.();
    return content ? `${typeName(m)} "${content.slice(0, 40)}"` : typeName(m);
  };
  const boundsOf = (m: Mob): Bounds | null => {
    try {
      const b = m.getBounds?.();
      if (!b || ![b.min.x, b.min.y, b.max.x, b.max.y].every(Number.isFinite)) return null;
      return b;
    } catch {
      return null;
    }
  };
  // Text/MathTex are textured planes whose bounds include padding and KaTeX's line box
  // (often 3x the glyph height). Shrink them to the opaque pixels of the texture.
  const tightBounds = (m: Mob): Bounds | null => {
    const b = boundsOf(m);
    const canvas = m._renderState?.canvas ?? m._canvas;
    if (!b || !canvas || !canvas.width || !canvas.height) return b;
    let data: Uint8ClampedArray;
    try {
      data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      return b;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    return {
      min: { x: b.min.x + (x0 / canvas.width) * w, y: b.max.y - ((y1 + 1) / canvas.height) * h },
      max: { x: b.min.x + ((x1 + 1) / canvas.width) * w, y: b.max.y - (y0 / canvas.height) * h },
    };
  };
  const fmt = (b: Bounds) => `x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}, y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}`;
  const toScene = (px: number, py: number): [number, number] => [
    (px / width) * frameW - frameW / 2,
    frameH / 2 - (py / height) * frameH,
  ];

  // Out of frame: top-level mobjects only (their bounds include children).
  const outOfFrame: string[] = [];
  const top = [...scene.mobjects];
  for (const m of top) {
    const b = isText(m) ? tightBounds(m) : boundsOf(m);
    if (!b) continue;
    if (b.min.x < -frameW / 2 - TOL || b.max.x > frameW / 2 + TOL || b.min.y < -frameH / 2 - TOL || b.max.y > frameH / 2 + TOL) {
      outOfFrame.push(`${label(m)} [${fmt(b)}] exceeds frame ±${(frameW / 2).toFixed(2)} × ±${(frameH / 2).toFixed(2)}`);
    }
  }

  // Collect text leaves (don't descend into a text mobject's glyphs).
  const texts: { m: Mob; b: Bounds }[] = [];
  const seen = new Set<Mob>();
  const walk = (m: Mob) => {
    if (seen.has(m)) return;
    seen.add(m);
    if (isText(m)) {
      const b = tightBounds(m);
      if (b && b.max.x - b.min.x > 1e-3 && b.max.y - b.min.y > 1e-3) texts.push({ m, b });
      return;
    }
    for (const c of m.children ?? []) walk(c);
  };
  top.forEach(walk);

  const area = (b: Bounds) => (b.max.x - b.min.x) * (b.max.y - b.min.y);
  const intersect = (a: Bounds, b: Bounds) =>
    Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) *
    Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));

  const textOverlaps: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const ratio = intersect(texts[i].b, texts[j].b) / Math.min(area(texts[i].b), area(texts[j].b));
      if (ratio >= overlapMin) {
        textOverlaps.push(`${label(texts[i].m)} overlaps ${label(texts[j].m)} (${Math.round(ratio * 100)}%)`);
      }
    }
  }

  // Text hidden under the Controls panel (a DOM overlay on top of the canvas).
  const canvas = document.querySelector('canvas');
  const canvasRect = canvas?.getBoundingClientRect() ?? { left: 0, top: 0 };
  document.querySelectorAll('.manimweb-controls').forEach((panel) => {
    const r = panel.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const [x1, y1] = toScene(r.left - canvasRect.left, r.bottom - canvasRect.top);
    const [x2, y2] = toScene(r.right - canvasRect.left, r.top - canvasRect.top);
    const panelBounds: Bounds = { min: { x: x1, y: y1 }, max: { x: x2, y: y2 } };
    for (const t of texts) {
      const ratio = intersect(t.b, panelBounds) / area(t.b);
      if (ratio >= overlapMin) textOverlaps.push(`${label(t.m)} is hidden under the controls panel (${Math.round(ratio * 100)}%)`);
    }
  });

  // LaTeX source written into a plain Text mobject instead of MathTex.
  const rawLatex: string[] = [];
  for (const t of texts) {
    if (isA(t.m, 'MathTex')) continue;
    const s = t.m.getText?.() ?? '';
    if (/\\[a-zA-Z]{2,}|[\^_]\{/.test(s)) rawLatex.push(`${typeName(t.m)} shows raw LaTeX: "${s.slice(0, 60)}"`);
  }

  return {
    playCount: sb.playCount,
    controls: controlsCount,
    draggables: sb.draggables.length,
    clickables: sb.clickables.length,
    hoverables: sb.hoverables.length,
    outOfFrame,
    textOverlaps,
    rawLatex,
  };
}

async function comparePixels({ final, idle, interacted }: { final: string; idle: string; interacted: string }) {
  const W = 320;
  const H = 180;
  const decode = async (b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  };
  const pixelsOf = (bmp: ImageBitmap) => {
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };
  const thumb = async (bmp: ImageBitmap) => {
    const c = new OffscreenCanvas(640, 360);
    c.getContext('2d')!.drawImage(bmp, 0, 0, 640, 360);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin);
  };
  const changed = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++;
    }
    return n / (W * H);
  };

  const [fBmp, iBmp, xBmp] = await Promise.all([decode(final), decode(idle), decode(interacted)]);
  const f = pixelsOf(fBmp);
  const i = pixelsOf(iBmp);

  let lit = 0;
  for (let p = 0; p < f.length; p += 4) {
    if (Math.max(f[p], f[p + 1], f[p + 2]) > 40) lit++;
  }

  return {
    nonBlank: lit / (W * H),
    idleChange: changed(f, i),
    finalThumb: await thumb(fBmp),
    interactedThumb: await thumb(xBmp),
  };
}

/** Pixel position (page coordinates) of an instrumented mobject's centre — what manim-web hit-tests against. */
function locateTarget({ list, index, width, height }: { list: 'hoverables' | 'clickables' | 'draggables'; index: number; width: number; height: number }) {
  type Mob = { getCenter?: () => number[]; parent?: Mob | null; constructor: { name: string } };
  const sb = window.__sandbox;
  const m = sb?.[list][index] as Mob | undefined;
  const c = m?.getCenter?.();
  if (!sb || !m || !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const scene = sb.scene as { mobjects: Iterable<unknown>; camera?: { frameWidth?: number; frameHeight?: number } };
  const frameW = scene.camera?.frameWidth ?? 14;
  const frameH = scene.camera?.frameHeight ?? (frameW * height) / width;
  const rect = document.querySelector('canvas')?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const top = new Set(scene.mobjects);
  let inScene = false;
  for (let p: Mob | null | undefined = m; p; p = p.parent) if (top.has(p)) inScene = true;
  const M = sb.manim as Record<string, unknown>;
  const name = ['Dot', 'Circle', 'Square', 'Rectangle', 'Polygon', 'Line', 'Arrow', 'Text', 'MathTex', 'VGroup', 'FunctionGraph']
    .find((n) => typeof M[n] === 'function' && m instanceof (M[n] as new () => unknown)) ?? m.constructor.name;
  return {
    label: `${name} at (${c[0].toFixed(1)}, ${c[1].toFixed(1)})`,
    inScene,
    point: [rect.left + ((c[0] + frameW / 2) / frameW) * width, rect.top + ((frameH / 2 - c[1]) / frameH) * height] as [number, number],
  };
}

/** Fraction of pixels that differ between two same-size PNG screenshots. */
async function pixelChange({ a, b }: { a: string; b: string }) {
  const load = async (b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const [x, y] = await Promise.all([load(a), load(b)]);
  let n = 0;
  for (let i = 0; i < x.length; i += 4) {
    if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 60) n++;
  }
  return n / (x.length / 4);
}
