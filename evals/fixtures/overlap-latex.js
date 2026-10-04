// expect: runs=true noTextOverlap=false noRawLatex=false interactive=false
const t1 = new Text({ text: 'Area = 1/2 bh', fontSize: 36 });
const t2 = new Text({ text: 'Base times height', fontSize: 36 });
const t3 = new Text({ text: '\\frac{1}{2} b h', fontSize: 36 });
t1.moveTo([0, 0, 0]);
t2.moveTo([0.2, 0.05, 0]);
t3.moveTo([0, -2, 0]);
scene.add(t1, t2, t3);
await scene.wait(999999);
