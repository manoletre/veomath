// expect: runs=true interactive=true respondsToInteraction=true canvasInteraction=false
// Hover with no updater anywhere: only visible because the runtime renders every frame.
const p = new Dot({ point: [1, 1, 0], radius: 0.12, color: YELLOW });
const info = new Text({ text: '(1, 1)', fontSize: 28 });
info.moveTo([1.7, 1.5, 0]);
scene.add(p);
makeHoverable(p, scene, { onHoverStart: () => scene.add(info), onHoverEnd: () => scene.remove(info) });
await scene.wait(999999);
