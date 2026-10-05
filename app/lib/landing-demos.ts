// Examples shown on the signed-out landing page: a prompt and the manim-web scene it produces.
// The triangle and secant scenes come from the visualization benchmark (evals/results, openai/gpt-6.1-sol)
// with a short scripted intro added so the scene moves on its own before the visitor takes over.

export interface LandingDemo {
  id: string;
  prompt: string;
  /** Tells the visitor how to play with the live scene. */
  hint: string;
  code: string;
}

const triangleAngleSum = String.raw`let vx = 0.5;
let vy = 1.3;
const left = [-3, -1.3, 0];
const right = [3, -1.3, 0];
const title = new Text({ text: 'Three angles make a straight angle', fontSize: 30, color: WHITE });
title.moveTo([0, 3.2, 0]);
const equation = new MathTex({ latex: '\\alpha + \\beta + \\gamma = 180^\\circ' });
await equation.waitForRender();
equation.moveTo([0, 2.55, 0]);
const triangle = new Polygon({ vertices: [left, right, [vx, vy, 0]], color: WHITE });
triangle.setFill(BLUE, 0.06);
const parallel = new DashedLine({ start: [-4.7, vy, 0], end: [4.7, vy, 0], color: GRAY });
const parallelLabel = new Text({ text: 'parallel to the base', fontSize: 18, color: GRAY });
const handle = new Dot({ point: [vx, vy, 0], radius: 0.13, color: YELLOW });

function sectorPoints(center, startAngle, endAngle, radius) {
  const points = [center];
  for (let i = 0; i <= 32; i++) {
    const angle = startAngle + (endAngle - startAngle) * i / 32;
    points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), 0]);
  }
  return points;
}
function newSector(color) {
  const wedge = new Polygon({ vertices: sectorPoints(left, 0, 0.5, 0.5), color });
  wedge.setFill(color, 0.45);
  wedge.setStrokeWidth(1);
  return wedge;
}
const baseAlpha = newSector(BLUE);
const baseBeta = newSector(GREEN);
const copiedAlpha = newSector(BLUE);
const copiedBeta = newSector(GREEN);
const apexGamma = newSector(YELLOW);
const alphaLabel = new Text({ text: '', fontSize: 19, color: BLUE });
const betaLabel = new Text({ text: '', fontSize: 19, color: GREEN });
const gammaLabel = new Text({ text: '', fontSize: 19, color: YELLOW });
const topAlphaLabel = new Text({ text: '', fontSize: 19, color: BLUE });
const topBetaLabel = new Text({ text: '', fontSize: 19, color: GREEN });
const readout = new Text({ text: '', fontSize: 27, color: WHITE });
readout.moveTo([0, -2.1, 0]);
const caption = new Text({ text: 'Matching colors are equal angles; together they fill the straight line.', fontSize: 20, color: GRAY });
caption.moveTo([0, -2.7, 0]);
const hint = new Text({ text: 'Drag the yellow vertex to reshape the triangle', fontSize: 22, color: YELLOW });
hint.moveTo([0, -3.25, 0]);

function placeAngleLabel(label, center, angle, radius, value) {
  label.setText(value.toFixed(1) + '°');
  label.moveTo([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), 0]);
}
function update() {
  const apex = [vx, vy, 0];
  const alpha = Math.atan2(vy - left[1], vx - left[0]);
  const beta = Math.atan2(vy - right[1], right[0] - vx);
  const gamma = Math.PI - alpha - beta;
  const degrees = 180 / Math.PI;
  triangle.setVertices([left, right, apex]);
  handle.moveTo(apex);
  parallel.setStart([-4.7, vy, 0]);
  parallel.setEnd([4.7, vy, 0]);
  parallelLabel.moveTo([3.6, vy + 0.25, 0]);
  baseAlpha.setVertices(sectorPoints(left, 0, alpha, 0.55));
  baseBeta.setVertices(sectorPoints(right, Math.PI - beta, Math.PI, 0.55));
  copiedAlpha.setVertices(sectorPoints(apex, -Math.PI, -Math.PI + alpha, 0.7));
  apexGamma.setVertices(sectorPoints(apex, -Math.PI + alpha, -beta, 0.7));
  copiedBeta.setVertices(sectorPoints(apex, -beta, 0, 0.7));
  placeAngleLabel(alphaLabel, left, alpha / 2, 0.94, alpha * degrees);
  placeAngleLabel(betaLabel, right, Math.PI - beta / 2, 0.94, beta * degrees);
  placeAngleLabel(topAlphaLabel, apex, -Math.PI + alpha / 2, 1.06, alpha * degrees);
  placeAngleLabel(topBetaLabel, apex, -beta / 2, 1.06, beta * degrees);
  placeAngleLabel(gammaLabel, apex, (-Math.PI + alpha - beta) / 2, 1.03, gamma * degrees);
  readout.setText((alpha * degrees).toFixed(1) + '° + ' + (beta * degrees).toFixed(1) + '° + ' + (gamma * degrees).toFixed(1) + '° = 180°');
}
update();
scene.add(title, equation);
await scene.play(new Create(triangle));
await scene.play(new Create(parallel));
scene.add(baseAlpha, baseBeta, copiedAlpha, apexGamma, copiedBeta, alphaLabel, betaLabel, gammaLabel, topAlphaLabel, topBetaLabel, parallelLabel, handle, readout, caption, hint);

// Reshape the triangle once to show the angles keep filling the line for any triangle.
async function moveApex(toX, toY, ms) {
  const fromX = vx, fromY = vy, start = performance.now();
  for (;;) {
    const p = Math.min(1, (performance.now() - start) / ms);
    const e = p * p * (3 - 2 * p);
    vx = fromX + (toX - fromX) * e;
    vy = fromY + (toY - fromY) * e;
    update();
    if (p >= 1) return;
    await scene.wait(1 / 60);
  }
}
await scene.wait(0.8);
await moveApex(-1.3, 0.9, 1500);
await moveApex(1.3, 1.7, 2000);
await moveApex(0.5, 1.3, 1200);

makeDraggable(handle, scene, {
  onDrag: (mob, pos) => {
    vx = Math.max(-1.5, Math.min(1.5, pos[0]));
    vy = Math.max(0.4, Math.min(1.8, pos[1]));
    update();
  }
});
await scene.wait(999999);
`;

const secantToTangent = String.raw`const formula = new MathTex({ latex: 'f(x)=\\frac{x^2}{2},\\quad a=1,\\qquad m_h=\\frac{f(1+h)-f(1)}{h}=1+\\frac{h}{2}\\longrightarrow f\'(1)=1' });
await formula.waitForRender();
formula.scale(0.65);
formula.moveTo([0, 2.95, 0]);

const ax = new Axes({ xRange: [-2.5, 3.2, 1], yRange: [-1, 5.5, 1], xLength: 8.4, yLength: 4.3, tips: false });
const f = x => x * x / 2;
const curve = ax.plot(f, { color: BLUE });
let h = 1.5;
const p = ax.c2p(1, f(1));
const tangent = new DashedLine({ start: ax.c2p(-0.3, -0.8), end: ax.c2p(3.2, 2.7), color: GREEN });
const secant = new Line({ start: p, end: ax.c2p(2.5, f(2.5)), color: YELLOW });
secant.setStrokeWidth(4);
const baseDot = new Dot({ point: p, radius: 0.09, color: BLUE });
const handle = new Dot({ point: ax.c2p(1 + h, f(1 + h)), radius: 0.14, color: YELLOW });
const pLabel = new Text({ text: 'P', fontSize: 23, color: BLUE });
pLabel.moveTo([p[0] - 0.25, p[1] + 0.3, 0]);
const qLabel = new Text({ text: 'Q', fontSize: 23, color: YELLOW });
const interval = new Line({ start: ax.c2p(1, -0.55), end: ax.c2p(2.5, -0.55), color: YELLOW });
const firstGuide = new DashedLine({ start: ax.c2p(1, -0.55), end: p, color: GRAY });
const secondGuide = new DashedLine({ start: ax.c2p(2.5, -0.55), end: ax.c2p(2.5, f(2.5)), color: GRAY });
const hLabel = new Text({ text: 'h', fontSize: 22, color: YELLOW });
const readout = new Text({ text: '', fontSize: 25, color: YELLOW });
readout.moveTo([-0.8, -2.65, 0]);
const legend = new Text({ text: 'Green dashed: tangent slope = 1', fontSize: 20, color: GREEN });
legend.moveTo([-0.8, -3.08, 0]);
const hint = new Text({ text: 'Drag Q toward P, or past it to approach from the left', fontSize: 20, color: GRAY });
hint.moveTo([0, -3.48, 0]);
const zeroButton = new Text({ text: 'Set h = 0', fontSize: 23, color: GREEN });
zeroButton.moveTo([4.9, -2.65, 0]);
const resetButton = new Text({ text: 'Reset', fontSize: 21, color: WHITE });
resetButton.moveTo([4.9, -3.08, 0]);

scene.add(formula, ax, curve, tangent, firstGuide, secondGuide, interval, secant, baseDot, handle, pLabel, qLabel, hLabel, readout, legend, hint, zeroButton, resetButton);

function update() {
  const xq = 1 + h;
  const q = ax.c2p(xq, f(xq));
  const m = 1 + h / 2;
  const isLimit = Math.abs(h) < 0.000001;
  const left = Math.max(-2.5, 1 + (-0.8 - 0.5) / m);
  const right = Math.min(3.2, 1 + (5.25 - 0.5) / m);
  secant.setStart(ax.c2p(left, 0.5 + m * (left - 1)));
  secant.setEnd(ax.c2p(right, 0.5 + m * (right - 1)));
  secant.setColor(isLimit ? GREEN : YELLOW);
  handle.moveTo(q);
  qLabel.moveTo([q[0] + 0.23, q[1] + 0.26, 0]);
  qLabel.setText(isLimit ? 'Q = P' : 'Q');
  qLabel.setOpacity(isLimit ? 0 : 1);
  secondGuide.setStart(ax.c2p(xq, -0.55));
  secondGuide.setEnd(q);
  interval.setStart(ax.c2p(1, -0.55));
  interval.setEnd(ax.c2p(xq, -0.55));
  interval.setOpacity(isLimit ? 0 : 1);
  hLabel.moveTo(ax.c2p(1 + h / 2, -0.83));
  hLabel.setText('h = ' + h.toFixed(2));
  readout.setText(isLimit ? 'h = 0: tangent slope = 1 (the limit)' : 'h = ' + h.toFixed(3) + '     secant slope = ' + m.toFixed(3));
  readout.setColor(isLimit ? GREEN : YELLOW);
}
update();

// Slide Q into P once so the secant visibly turns into the tangent, then hand over.
async function slideH(to, ms) {
  const from = h, start = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - start) / ms);
    h = from + (to - from) * t * t * (3 - 2 * t);
    update();
    if (t >= 1) return;
    await scene.wait(1 / 60);
  }
}
await scene.wait(1);
await slideH(0, 3000);
await scene.wait(1.5);
await slideH(1.5, 1200);

makeDraggable(handle, scene, { onDrag: (mob, pos) => {
  const x = ax.pointToCoords(pos)[0];
  h = Math.max(-1.6, Math.min(1.8, x - 1));
  update();
} });
makeClickable(zeroButton, scene, { onClick: () => { h = 0; update(); } });
makeClickable(resetButton, scene, { onClick: () => { h = 1.5; update(); } });
const hoverInfo = new Text({ text: '', fontSize: 20, color: YELLOW });
hoverInfo.moveTo([0, 2.25, 0]);
makeHoverable(handle, scene, {
  onHoverStart: () => {
    hoverInfo.setText('Q = (' + (1 + h).toFixed(3) + ', ' + f(1 + h).toFixed(3) + ')');
    scene.add(hoverInfo);
  },
  onHoverEnd: () => scene.remove(hoverInfo)
});
await scene.wait(999999);
`;

const unitCircleWaves = String.raw`const tau = 2 * Math.PI;
const cx = -4.4, cy = 0.5, R = 1.3;
// Both graphs share the horizontal θ scale. The sine graph sits on the circle's centre line with the
// circle's radius as amplitude, so a point's height carries straight across to the curve.
const gx = -2.3, k = 8.2 / tau;
const sy = cy;
const cosY = -2.45, cosA = 0.85;
let theta = 0;
const gxAt = t => gx + t * k;

const title = new Text({ text: 'Sine is the height, cosine is the width', fontSize: 30, color: WHITE });
title.moveTo([0, 3.4, 0]);
const readout = new Text({ text: '', fontSize: 23, color: WHITE });
readout.moveTo([0, 2.8, 0]);

const circle = new Circle({ radius: R, color: GRAY });
circle.moveTo([cx, cy, 0]);
const hAxis = new Line({ start: [cx - R - 0.3, cy, 0], end: [cx + R + 0.3, cy, 0], color: GRAY });
const vAxis = new Line({ start: [cx, cy - R - 0.3, 0], end: [cx, cy + R + 0.3, 0], color: GRAY });
hAxis.setOpacity(0.5);
vAxis.setOpacity(0.5);

function graphAxes(y, amp) {
  const parts = [
    new Line({ start: [gx, y, 0], end: [gxAt(tau) + 0.25, y, 0], color: GRAY }),
    new Line({ start: [gx, y - amp - 0.15, 0], end: [gx, y + amp + 0.15, 0], color: GRAY }),
  ];
  for (const t of [Math.PI / 2, Math.PI, 3 * Math.PI / 2, tau]) {
    parts.push(new Line({ start: [gxAt(t), y - 0.07, 0], end: [gxAt(t), y + 0.07, 0], color: GRAY }));
  }
  for (const v of [-1, 1]) {
    const guide = new DashedLine({ start: [gx, y + v * amp, 0], end: [gxAt(tau), y + v * amp, 0], color: GRAY });
    guide.setOpacity(0.3);
    parts.push(guide);
  }
  return parts;
}
const axesParts = [...graphAxes(sy, R), ...graphAxes(cosY, cosA)];
const tickLabels = [['π/2', Math.PI / 2], ['π', Math.PI], ['3π/2', 3 * Math.PI / 2], ['2π', tau]].map(([text, t]) => {
  const label = new Text({ text, fontSize: 17, color: GRAY });
  label.moveTo([gxAt(t), cosY - cosA - 0.4, 0]);
  return label;
});
const sinName = new Text({ text: 'sin θ', fontSize: 24, color: TEAL });
sinName.moveTo([gx - 0.55, sy + R + 0.3, 0]);
const cosName = new Text({ text: 'cos θ', fontSize: 24, color: ORANGE });
cosName.moveTo([gx - 0.55, cosY + cosA + 0.3, 0]);

const tiny = 0.0001;
const sinCurve = new ParametricFunction({ func: t => [gxAt(t), sy + R * Math.sin(t), 0], tRange: [0, tiny], color: TEAL, strokeWidth: 4, numSamples: 240 });
const cosCurve = new ParametricFunction({ func: t => [gxAt(t), cosY + cosA * Math.cos(t), 0], tRange: [0, tiny], color: ORANGE, strokeWidth: 4, numSamples: 240 });
const angleArc = new ParametricFunction({ func: t => [cx + 0.38 * Math.cos(t), cy + 0.38 * Math.sin(t), 0], tRange: [0, tiny], color: YELLOW, numSamples: 60 });

const spoke = new Line({ start: [cx, cy, 0], end: [cx + R, cy, 0], color: WHITE });
const cosLeg = new Line({ start: [cx, cy, 0], end: [cx + R, cy, 0], color: ORANGE });
const sinLeg = new Line({ start: [cx + R, cy, 0], end: [cx + R, cy, 0], color: TEAL });
cosLeg.setStrokeWidth(6);
sinLeg.setStrokeWidth(6);
const link = new DashedLine({ start: [cx + R, cy, 0], end: [gx, sy, 0], color: TEAL });
link.setOpacity(0.6);
const sinBar = new Line({ start: [gx, sy, 0], end: [gx, sy, 0], color: TEAL });
const cosBar = new Line({ start: [gx, cosY, 0], end: [gx, cosY + cosA, 0], color: ORANGE });
sinBar.setStrokeWidth(5);
cosBar.setStrokeWidth(5);
const sinDot = new Dot({ point: [gx, sy, 0], radius: 0.09, color: TEAL });
const cosDot = new Dot({ point: [gx, cosY + cosA, 0], radius: 0.09, color: ORANGE });
const handle = new Dot({ point: [cx + R, cy, 0], radius: 0.14, color: YELLOW });
const hint = new Text({ text: 'Drag the yellow point', fontSize: 21, color: YELLOW });
hint.moveTo([cx, cy - R - 0.65, 0]);
const hint2 = new Text({ text: 'around the circle', fontSize: 21, color: YELLOW });
hint2.moveTo([cx, cy - R - 1.05, 0]);

let traced = 0;
function update() {
  const s = Math.sin(theta), c = Math.cos(theta);
  const point = [cx + R * c, cy + R * s, 0];
  const foot = [cx + R * c, cy, 0];
  const x = gxAt(theta);
  handle.moveTo(point);
  spoke.setEnd(point);
  cosLeg.setEnd(foot);
  sinLeg.setStart(foot);
  sinLeg.setEnd(point);
  angleArc.setTRange([0, Math.max(theta, tiny)]);
  sinCurve.setTRange([0, Math.max(traced, tiny)]);
  cosCurve.setTRange([0, Math.max(traced, tiny)]);
  link.setStart(point);
  link.setEnd([x, sy + R * s, 0]);
  sinBar.setStart([x, sy, 0]);
  sinBar.setEnd([x, sy + R * s, 0]);
  sinDot.moveTo([x, sy + R * s, 0]);
  cosBar.setStart([x, cosY, 0]);
  cosBar.setEnd([x, cosY + cosA * c, 0]);
  cosDot.moveTo([x, cosY + cosA * c, 0]);
  const fmt = v => (v < -0.005 ? '−' : '') + Math.abs(v).toFixed(2);
  readout.setText('θ = ' + Math.round(theta * 180 / Math.PI) + '°      sin θ = ' + fmt(s) + '      cos θ = ' + fmt(c));
}
update();

scene.add(title, hAxis, vAxis, ...axesParts, ...tickLabels, sinName, cosName);
await scene.play(new Create(circle));
scene.add(readout, sinCurve, cosCurve, angleArc, cosLeg, sinLeg, spoke, link, sinBar, cosBar, sinDot, cosDot, handle);
await scene.wait(0.6);

async function turn(to, ms, trace) {
  const from = theta, start = performance.now();
  for (;;) {
    const p = Math.min(1, (performance.now() - start) / ms);
    theta = from + (to - from) * p;
    if (trace) traced = theta;
    update();
    if (p >= 1) return;
    await scene.wait(1 / 60);
  }
}
// One full turn draws one full wave of each.
await turn(tau, 7000, true);
await scene.wait(0.6);
theta = 0;
await turn(Math.PI / 3, 1400, false);
scene.add(hint, hint2);

makeDraggable(handle, scene, { onDrag: (mob, pos) => {
  const angle = Math.atan2(pos[1] - cy, pos[0] - cx);
  theta = angle < 0 ? angle + tau : angle;
  update();
} });
await scene.wait(999999);
`;

export const LANDING_DEMOS: LandingDemo[] = [
  {
    id: 'triangle',
    prompt: 'Why do the angles of a triangle always add up to 180°?',
    hint: 'drag the yellow vertex. The three angles still fill the straight line.',
    code: triangleAngleSum,
  },
  {
    id: 'derivative',
    prompt: 'Where does the derivative come from? Show me a secant line turning into the tangent.',
    hint: 'drag Q toward P and watch the secant’s slope settle on the tangent’s.',
    code: secantToTangent,
  },
  {
    id: 'unit-circle',
    prompt: 'How do the sine and cosine waves come from the unit circle?',
    hint: 'drag the yellow point around the circle and follow both waves.',
    code: unitCircleWaves,
  },
];
