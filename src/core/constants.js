/* =========================================================================
   CONSTANTS — world sizing + custom-asset manifest.

   ASSETS: set a url to null to keep the built-in procedural version. Files
   live next to index.html (models/ + textures/). Tune scale/rot/lift by eye.
   OBJ_SCALE multiplies everything that stands on the ground.
   ========================================================================= */
export const OBJ_SCALE = 1.35;

export const WATER_Y = -3;
export const CHUNK = 80, SEG = 24;

export const ASSETS = {
  saucer:  { url:'models/saucer.glb',    scale:5.0, rotY:0,        yOffset:0, seat:false },
  sheep:   { url:'models/sheep.glb',     scale:1.0, rotY:Math.PI,  yOffset:0 },
  duck:    { url:'models/duck.glb',      scale:1.0, rotY:Math.PI,  yOffset:0 },
  camel:   { url:'models/camel.glb',     scale:1.0, rotY:Math.PI,  yOffset:0 },
  goat:    { url:'models/goat.glb',      scale:1.0, rotY:Math.PI,  yOffset:0 },
  grass:   { url:'textures/grass.jpg',   repeat:6 },
  mountain:{ url:'textures/mountain.jpg', repeat:5 },
  sand:    { url:'textures/sand.jpg',    repeat:6 },
  crystal: { url:'models/crystal.glb',   scale:1.0, rotY:0,        yOffset:0 },
  barn:    { url:'models/barn.glb',      scale:2.0, rotY:0,        yOffset:0 },
  hiker:   { url:'models/hiker.glb',     scale:1.0, rotY:Math.PI,  yOffset:0 },
  tree:    { url:'models/tree.glb',      scale:2.0, rotY:0,        yOffset:0 },
};
