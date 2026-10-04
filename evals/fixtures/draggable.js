// expect: runs=true interactive=true respondsToInteraction=true canvasInteraction=true stableUnderInteraction=true
const dot = new Dot({ point: [1, 1, 0], color: YELLOW });
dot.scale(2);
const seg = new Polygon({ vertices: [[0, 0, 0], [1, 1, 0]], color: WHITE });
seg.setStrokeWidth(4).setFillOpacity(0);
scene.add(seg, dot);
makeDraggable(dot, scene);
seg.addUpdater(() => seg.setVertices([[0, 0, 0], dot.getCenter()]));
await scene.wait(999999);
