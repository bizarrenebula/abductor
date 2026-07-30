/* Shared mesh helpers used by every procedural builder. */
import { THREE } from './three.js';
import { env } from './env.js';
import { disposable } from './dispose.js';

/* Flat-shaded by default: the low-poly art direction wants visible facets so
   moonlight breaks over each face. One shared, faceted material style across
   every procedural builder — cheap and cohesive. */
/* These three are the funnel almost every procedural builder goes through, and
   everything they make is per-instance — so this is where streamed content gets
   marked disposable (see core/dispose.js). Builders that deliberately SHARE a
   geometry/material across instances (street lamps, headlight pools) construct
   their meshes directly and are therefore never marked, so an unload can never
   free something another object is still using. */
export function mat(hex,rough){return disposable(new THREE.MeshStandardMaterial({color:hex,roughness:rough||0.85,metalness:0.02,flatShading:true}));}
/* Warm emissive material for glowing windows / lit signs. */
export function glowMat(hex,intensity){return disposable(new THREE.MeshStandardMaterial({color:hex,emissive:hex,emissiveIntensity:intensity||1.2,roughness:0.6,metalness:0,flatShading:true}));}
export function part(geo,m,x,y,z){disposable(geo);const me=new THREE.Mesh(geo,m);me.position.set(x,y,z);me.castShadow=!env.LOW_END;return me;}

/* Measure an object's real extent so collision works for both procedural shapes
   and GLB models, whose sizes differ a lot. Stores a horizontal radius and a
   height above the base. Call after the final scale is applied.
   userData.slim tightens the radius for things with a narrow trunk. */
export function measureSolid(g){
  g.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(g);
  const u=g.userData;
  if(!isFinite(box.min.y)){u.rad=1.2;u.top=4;return;}
  u.rad=Math.max(Math.abs(box.max.x-box.min.x),Math.abs(box.max.z-box.min.z))*0.5;
  u.top=box.max.y-box.min.y;
  // A canopy-wide radius would make trees feel like invisible walls.
  u.rad*=u.slim?0.42:0.8;
}
