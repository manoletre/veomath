// expect: runs=true interactive=true respondsToInteraction=false
const sq = new Square({ sideLength: 2, color: GREEN });
scene.add(sq);
const controls = new Controls(scene);
controls.addSlider({ label: 'size', min: 0.5, max: 3, value: 1, step: 0.1, onChange: () => {} });
await scene.wait(999999);
