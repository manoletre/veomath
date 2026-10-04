// expect: runs=true completes=true inFrame=false interactive=false
const c = new Circle({ radius: 1.5, color: BLUE });
c.moveTo([7.5, 0, 0]);
const s = new Square({ sideLength: 2, color: RED });
scene.add(c, s);
await scene.wait(999999);
