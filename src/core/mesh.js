/* Shared mesh helpers used by every procedural builder. */
import { THREE } from './three.js';
import { env } from './env.js';

export function mat(hex,rough){return new THREE.MeshStandardMaterial({color:hex,roughness:rough||0.85,metalness:0.02});}
export function part(geo,m,x,y,z){const me=new THREE.Mesh(geo,m);me.position.set(x,y,z);me.castShadow=!env.LOW_END;return me;}

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
