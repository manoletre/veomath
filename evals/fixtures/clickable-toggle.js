// expect: runs=true interactive=true respondsToInteraction=true canvasInteraction=true stableUnderInteraction=true
// setFill inside onClick with no updater anywhere — visible only with per-frame rendering.
const sq = new Square({ sideLength: 2, color: BLUE });
sq.setFill(BLUE, 0.5);
scene.add(sq);
let on = false;
makeClickable(sq, scene, { onClick: () => { on = !on; sq.setFill(on ? ORANGE : BLUE, 0.5); } });
await scene.wait(999999);
