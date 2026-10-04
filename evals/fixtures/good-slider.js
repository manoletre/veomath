// expect: runs=true completes=true nonBlank=true inFrame=true noTextOverlap=true noRawLatex=true interactive=true respondsToInteraction=true canvasInteraction=false stableUnderInteraction=true
const axes = new Axes({ xRange: [-4, 4, 1], yRange: [-2, 6, 1], xLength: 7, yLength: 5, tips: false });
let a = 1;
let curve = axes.plot(x => a * x * x, { color: BLUE, xRange: [-2.4, 2.4] });
const title = new MathTex({ latex: 'y = a x^2' });
await title.waitForRender();
title.moveTo([-3, 3.2, 0]);
scene.add(axes, title);
await scene.play(new Create(curve));
const controls = new Controls(scene);
controls.addSlider({ label: 'a', min: -2, max: 2, value: 1, step: 0.1, onChange: (v) => {
  a = v;
  scene.remove(curve);
  curve = axes.plot(x => a * x * x, { color: BLUE, xRange: [-2.4, 2.4] });
  scene.add(curve);
}});
await scene.wait(999999);
