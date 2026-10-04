// expect: completes=false
const c = new Circle({ radius: 1, color: BLUE });
scene.add(c);
await new Promise(() => {});
