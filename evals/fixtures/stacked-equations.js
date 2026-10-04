// expect: runs=true inFrame=true noTextOverlap=true
// Equations stacked 0.8 units apart near the top edge — fine visually, but raw MathTex bounds would flag both checks.
const lines = ['a^2 + b^2 = c^2', 'c^2 = a^2 + b^2 - 2ab\\cos C', '\\frac{1}{2} b h'];
for (let i = 0; i < lines.length; i++) {
  const t = new MathTex({ latex: lines[i] });
  await t.waitForRender();
  t.moveTo([0, 3.5 - i * 0.8, 0]);
  scene.add(t);
}
await scene.wait(999999);
