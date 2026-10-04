// expect: runs=false
const dot = new Dot({ point: [0, 0, 0], color: YELLOW });
const line = new Line({ start: [0, 0, 0], end: [1, 1, 0] });
scene.add(dot, line);
line.addUpdater(() => line.putStartAndEndOn([0, 0, 0], dot.getCenter()));
await scene.wait(999999);
