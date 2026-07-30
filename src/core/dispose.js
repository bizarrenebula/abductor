/* =========================================================================
   GPU RESOURCE DISPOSAL — releases WebGL memory when streamed content unloads.

   WHY: three.js frees GPU buffers/textures only on an explicit .dispose().
   Removing a mesh from the scene drops the JS reference but leaves the VBOs and
   texture memory allocated, so an endlessly streamed world grows until the tab
   is reloaded.

   WHY A WHITELIST: many builders share module-level geometry/materials between
   instances (street lamps, headlight pools, the ground/road materials, the
   ground textures). Disposing one of those when a single chunk unloads would
   break every other user of it. So nothing is disposed unless it was explicitly
   marked `disposable()` at creation — the safe direction to be wrong in: an
   unmarked resource merely keeps its old behaviour, it never breaks.

   Per-instance resources are marked centrally in core/mesh.js (mat/glowMat/part),
   which is the funnel almost every procedural builder goes through.
   ========================================================================= */

const DISPOSABLE = new WeakSet();

/* Mark resources as owned by a single instance and safe to free on unload.
   Returns the first argument, so it can wrap a constructor call inline. */
export function disposable(...res){
  for(const r of res) if(r && typeof r==='object') DISPOSABLE.add(r);
  return res[0];
}
export function isDisposable(r){ return !!r && DISPOSABLE.has(r); }

// Texture slots a standard/basic material may hold.
const TEX_SLOTS=['map','emissiveMap','normalMap','roughnessMap','metalnessMap','alphaMap',
                 'aoMap','lightMap','bumpMap','displacementMap','specularMap'];

function disposeMaterial(m){
  if(!isDisposable(m))return;
  // Only free textures that are themselves per-instance — shared atlases
  // (grass/sand/rock/road) are used by everything and must survive.
  for(const k of TEX_SLOTS){ const t=m[k]; if(t&&isDisposable(t))t.dispose(); }
  m.dispose();
}

/* Free every per-instance GPU resource under `obj`. Safe to call on anything:
   unmarked geometry/materials are left untouched. */
export function disposeDeep(obj){
  if(!obj||!obj.traverse)return;
  obj.traverse(o=>{
    if(o.geometry&&isDisposable(o.geometry))o.geometry.dispose();
    const m=o.material;
    if(Array.isArray(m))m.forEach(disposeMaterial);
    else if(m)disposeMaterial(m);
  });
}
