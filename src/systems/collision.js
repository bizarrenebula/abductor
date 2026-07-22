/* =========================================================================
   COLLISION — the ship is solid against trees and barns.

   Objects opt in by setting userData.solid, and carry a measured horizontal
   radius (u.rad) and height above their base (u.top) from measureSolid().
   The test is a cylinder overlap: close enough horizontally AND low enough
   vertically. Cylinders rather than boxes because the ship yaws constantly and
   both trees and the saucer are roughly radially symmetric.

   Cloak does not help here — it hides you from humans and hazards that aim at
   you, but a tree is not aiming.
   ========================================================================= */
import { S } from '../core/state.js';
import { SHIP_R } from '../core/constants.js';
import { saucer } from './saucer.js';
import { props, buildings } from '../entities/registry.js';
import { BeamSFX } from '../audio/sfx.js';

/* Only things nearer than this in X/Z are examined at all. Comfortably larger
   than any solid's radius plus the ship, so it cannot cause a missed hit. */
const NEAR = 24;

function hits(o){
  const u=o.userData;
  if(!u||!u.solid)return false;
  // A tree caught in the beam rises toward the ship and is already dissolving.
  // Without this, beaming a tree would instantly crash you into it.
  if(u.gone!=null||u.lift>0.02)return false;
  const dx=saucer.position.x-o.position.x, dz=saucer.position.z-o.position.z;
  const r=(u.rad||1.2)+SHIP_R;
  if(dx*dx+dz*dz>r*r)return false;
  // Vertical: the ship's underside must be below the object's top. o.position.y
  // sits at the object's base, so u.top is measured up from there.
  return saucer.position.y-1.5 < o.position.y+(u.top||4);
}

function scan(list){
  for(let i=0;i<list.length;i++){
    const o=list[i];
    const dx=saucer.position.x-o.position.x, dz=saucer.position.z-o.position.z;
    if(dx*dx+dz*dz>NEAR*NEAR)continue;      // cheap reject before the real test
    if(hits(o))return o;
  }
  return null;
}

export function updateCollision(){
  if(S.state!=='playing')return;
  const o=scan(buildings)||scan(props);
  if(!o)return;
  S.crashReason='impact';
  S.state='crashing';
  S.vy=-3;
  BeamSFX.stop();S.prevBeam=false;
}
