// Runtime fixes for manim-web 0.3.9 that generated interactive scenes depend on.
// Shared by the app (ManimRenderer) and the eval sandbox so evals measure what users get.
// These reach into private members; each patch checks the members exist and is applied once.

/** Waits at least this long are the end of the scripted part: generated code ends with `await scene.wait(999999)` to stay interactive. */
export const IDLE_WAIT_SECONDS = 60;

type Vec3 = [number, number, number];

interface Mob {
  children: Mob[];
  color: string;
  fillColor?: string;
  fillOpacity?: number;
  opacity: number;
  position: { x: number; y: number; z: number };
  getCenter(): Vec3;
  getFamily(): Mob[];
  shift(delta: Vec3): Mob;
  scale(factor: number): Mob;
  setColor(color: string): Mob;
  setFill?(color?: string, opacity?: number): Mob;
  setOpacity(opacity: number): Mob;
}

interface SceneLike {
  getCanvas(): HTMLCanvasElement;
}

interface DragOptions {
  constrainX?: [number, number] | null;
  constrainY?: [number, number] | null;
  snapToGrid?: number | null;
  onDrag?: (mob: Mob, position: Vec3, delta: Vec3) => void;
}

interface DraggableInternals {
  _mobject: Mob;
  _enabled: boolean;
  _lastPosition: Vec3 | null;
  _options: DragOptions;
  _screenToWorld(x: number, y: number): Vec3;
  _hitTest(point: Vec3): boolean;
  _startDrag(point: Vec3): void;
}

interface HoverOptions {
  hoverScale?: number;
  hoverColor?: string | null;
  hoverOpacity?: number | null;
  cursor?: string;
  onHoverStart?: (mob: Mob) => void;
  onHoverEnd?: (mob: Mob) => void;
}

interface HoverableInternals {
  _mobject: Mob;
  _scene: SceneLike;
  _options: HoverOptions;
  _isHovering: boolean;
  _saved?: { family: Mob[]; styles: Pick<Mob, 'color' | 'fillColor' | 'fillOpacity' | 'opacity'>[]; scale: number };
}

type Ctor = (abstract new (...args: never[]) => unknown) & { prototype: Record<string, unknown> } | undefined;

const PATCHED = Symbol.for('veomath.manimRuntimePatched');

/** Pointer targets smaller than this (scene units, ≈ 16 px at 1280 wide) get a larger hit area. */
const MIN_HIT_HALF_SIZE = 0.18;

/** Move so the visual centre lands on `target`. `moveTo` sets the local origin, which for Polygon, Line and plotted graphs is not the centre. */
function centreAt(mob: Mob, target: Vec3) {
  const c = mob.getCenter();
  mob.shift([target[0] - c[0], target[1] - c[1], 0]);
}

/**
 * Whether scale() keeps this mobject in place. Polygon, Line, Arrow and plotted graphs keep absolute
 * coordinates around a (0,0,0) origin, so scaling moves them, getCenter() ignores the scale, and a VGroup
 * holding them misplaces them when scaled. Shapes built around their own origin (Circle, Square, Text…)
 * scale in place, and so does Dot, which overrides scale().
 */
function scalesInPlace(mob: Mob, Dot: Ctor): boolean {
  if (Dot && mob instanceof Dot) return true;
  if (mob.children.length) return mob.children.every((c) => scalesInPlace(c, Dot));
  const c = mob.getCenter();
  return Math.abs(c[0] - mob.position.x) < 1e-6 && Math.abs(c[1] - mob.position.y) < 1e-6;
}

/** Apply the library patches. Safe to call on every render. */
export function patchManim(manim: Record<string, unknown>) {
  const m = manim as Record<string, Ctor>;
  // The module namespace is frozen, so the "already patched" flag lives on a prototype.
  const marker = m.Draggable?.prototype;
  if (!marker || marker[PATCHED as unknown as string]) return;
  marker[PATCHED as unknown as string] = true;

  // 1. Text-like mobjects draw into a 2D canvas uploaded as a texture. three.js allocates texture storage once,
  //    so when setText()/setValue() makes the canvas larger the upload fails and the old, stretched text stays.
  //    Dispose the texture on resize so it is reallocated.
  for (const name of ['Text', 'Paragraph', 'MarkupText', 'DecimalNumber']) {
    const proto = m[name]?.prototype;
    if (!proto || !Object.prototype.hasOwnProperty.call(proto, '_renderToCanvas')) continue;
    const render = proto._renderToCanvas as (this: { _canvas?: HTMLCanvasElement; _texture?: { dispose(): void; needsUpdate: boolean } }) => void;
    proto._renderToCanvas = function (this: { _canvas?: HTMLCanvasElement; _texture?: { dispose(): void; needsUpdate: boolean } }) {
      const w = this._canvas?.width;
      const h = this._canvas?.height;
      render.call(this);
      if (this._texture && this._canvas && (this._canvas.width !== w || this._canvas.height !== h)) {
        this._texture.dispose();
        this._texture.needsUpdate = true;
      }
    };
  }

  // 2. Small hit areas: a default Dot is 0.16 units (~15 px) across. Give every pointer target a minimum size.
  for (const name of ['Draggable', 'Clickable', 'Hoverable']) {
    const proto = m[name]?.prototype;
    if (!proto || typeof proto._hitTest !== 'function') continue;
    proto._hitTest = function (this: { _mobject: Mob & { getBoundingBox?(): { width: number; height: number } } }, p: Vec3) {
      const c = this._mobject.getCenter();
      const b = this._mobject.getBoundingBox?.() ?? { width: 1, height: 1 };
      return Math.abs(p[0] - c[0]) <= Math.max(b.width / 2, MIN_HIT_HALF_SIZE)
        && Math.abs(p[1] - c[1]) <= Math.max(b.height / 2, MIN_HIT_HALF_SIZE);
    };
  }

  const drag = m.Draggable?.prototype;
  if (drag && typeof drag._updateDrag === 'function' && typeof drag._handleMouseDown === 'function') {
    // 3. Dragging called moveTo(pointer), which for Polygon/Line/plots moves the local origin to the pointer,
    //    so the shape jumps away. Move the centre instead.
    drag._updateDrag = function (this: DraggableInternals, point: Vec3) {
      if (!this._lastPosition) return;
      const o = this._options;
      let [x, y] = point;
      if (o.constrainX) x = Math.max(o.constrainX[0], Math.min(o.constrainX[1], x));
      if (o.constrainY) y = Math.max(o.constrainY[0], Math.min(o.constrainY[1], y));
      if (o.snapToGrid) {
        x = Math.round(x / o.snapToGrid) * o.snapToGrid;
        y = Math.round(y / o.snapToGrid) * o.snapToGrid;
      }
      const target: Vec3 = [x, y, this._mobject.position.z];
      const delta: Vec3 = [x - this._lastPosition[0], y - this._lastPosition[1], 0];
      centreAt(this._mobject, target);
      this._lastPosition = target;
      o.onDrag?.(this._mobject, target, delta);
    };

    // 4. Every Draggable listens on the canvas independently, so one press on overlapping handles grabbed all
    //    of them and they stayed merged for good. Only the handle closest to the pointer starts dragging.
    type Claim = { draggable: DraggableInternals; distance: number; point: Vec3 };
    const claims = new WeakMap<Event, Claim[]>();
    const press = function (this: DraggableInternals, event: Event, clientX: number, clientY: number) {
      if (!this._enabled) return;
      const point = this._screenToWorld(clientX, clientY);
      if (!this._hitTest(point)) return;
      const c = this._mobject.getCenter();
      const claim = { draggable: this, distance: Math.hypot(point[0] - c[0], point[1] - c[1]), point };
      const existing = claims.get(event);
      if (existing) {
        existing.push(claim);
        return;
      }
      claims.set(event, [claim]);
      event.preventDefault();
      // All canvas listeners for this event run before the microtask, so every candidate has registered.
      queueMicrotask(() => {
        const best = claims.get(event)!.reduce((a, b) => (b.distance < a.distance ? b : a));
        best.draggable._startDrag(best.point);
      });
    };
    drag._handleMouseDown = function (this: DraggableInternals, e: MouseEvent) {
      press.call(this, e, e.clientX, e.clientY);
    };
    drag._handleTouchStart = function (this: DraggableInternals, e: TouchEvent) {
      if (e.touches.length === 1) press.call(this, e, e.touches[0].clientX, e.touches[0].clientY);
    };
  }

  const hover = m.Hoverable?.prototype;
  if (hover && typeof hover._startHover === 'function') {
    // 5. Hover effects were not reversible: hoverScale sent Polygons flying (see scalesInPlace), VGroups grew
    //    on every hover, and restoring the colour overwrote fills and per-child colours. Save and restore the
    //    whole family's style, and only scale mobjects that scale in place.
    hover._startHover = function (this: HoverableInternals) {
      this._isHovering = true;
      const mob = this._mobject;
      const o = this._options;
      const family = mob.getFamily();
      this._saved = {
        family,
        styles: family.map((f) => ({ color: f.color, fillColor: f.fillColor, fillOpacity: f.fillOpacity, opacity: f.opacity })),
        scale: o.hoverScale && scalesInPlace(mob, m.Dot) ? o.hoverScale : 1,
      };
      this._scene.getCanvas().style.cursor = o.cursor ?? 'pointer';
      if (this._saved.scale !== 1) mob.scale(this._saved.scale);
      if (o.hoverColor) mob.setColor(o.hoverColor);
      if (o.hoverOpacity != null) mob.setOpacity(o.hoverOpacity);
      o.onHoverStart?.(mob);
    };
    hover._endHover = function (this: HoverableInternals) {
      this._isHovering = false;
      const mob = this._mobject;
      const saved = this._saved;
      this._scene.getCanvas().style.cursor = 'default';
      if (saved) {
        if (saved.scale !== 1) mob.scale(1 / saved.scale);
        saved.family.forEach((f, i) => {
          const s = saved.styles[i];
          f.setColor(s.color);
          if (f.setFill && s.fillColor !== undefined) f.setFill(s.fillColor, s.fillOpacity);
          f.setOpacity(s.opacity);
        });
        this._saved = undefined;
      }
      this._options.onHoverEnd?.(mob);
    };
  }
}

/**
 * manim-web only repaints during scene.wait() if some top-level mobject had an updater when the wait began.
 * Otherwise drags, hovers, clicks and slider callbacks change mobjects that never reach the canvas.
 * Always render per frame while waiting.
 */
export function keepSceneLive(scene: unknown) {
  (scene as { _needsPerFrameRendering?: () => boolean })._needsPerFrameRendering = () => true;
}
