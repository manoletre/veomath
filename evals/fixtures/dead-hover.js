// expect: runs=true interactive=true respondsToInteraction=false canvasInteraction=false
// A hover effect that changes nothing — counts as interactive, but not as responding.
const tri = new Polygon({ vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], color: BLUE });
tri.setFill(BLUE, 0.5);
scene.add(tri);
makeHoverable(tri, scene, { hoverScale: 1, hoverOpacity: 1 });
await scene.wait(999999);
