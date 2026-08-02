/* =========================================================================
   SPAWN — where a run begins.

   The ship used to appear at the world origin whatever happened to be there,
   which is how runs occasionally ended two seconds after the arrival film: the
   collision test fires when the hull's underside is below a solid's top, so a
   lamp or a billboard standing on ground even slightly higher than the landing
   spot is a crash before the player has touched a control.

   So the origin is a starting point for a SEARCH, not the answer. Rings are
   walked outward and the first spot that can hold a landing wins — flat, dry,
   grass or sand, well clear of a road (which takes bridges, roadside lamps,
   billboards and fuel stations with it) and outside any village.

   The chosen point is then published on S so chunks.js can keep solid scenery
   out of a radius around it, and so the story lays its missions out relative to
   where the player actually is.
   ========================================================================= */
import { sample, slopeAt } from './terrain.js';
import { roadDist } from './roads.js';
import { inSettlement } from './settlements.js';
import { WATER_Y } from '../core/constants.js';

/* Nothing solid is placed within this of the spawn. Comfortably beyond
   collision.js's NEAR (24), so at the moment of arrival the scan has nothing
   to even consider. */
export const SPAWN_CLEAR = 26;

/* The search stays well inside RESTRICT_R (210): the landing site has to sit in
   the middle of the restricted area, not on its rim, or the Area 51 sign ends
   up standing on the edge with a highway just beyond it. Measured over 40 seeds
   the strict pass never needed to look past 142 anyway — the ground around the
   origin is guaranteed flat desert now (see world/regions.js). */
const RINGS=[0,34,68,104,142];
const ANGLES=16;

/* Can the ship be set down here? Checked over a small disc, not just the point:
   the hull is wide and the beam wider, and a level spot on the lip of a slope is
   not a level spot. `road` and `slope` are the two limits that get relaxed on
   the second pass. */
function landable(x,z,slope,road){
  for(const ring of [[0,1],[11,6],[19,8]]){
    const rad=ring[0], n=ring[1];
    for(let i=0;i<n;i++){
      const a=n===1?0:i/n*Math.PI*2;
      const px=x+Math.cos(a)*rad, pz=z+Math.sin(a)*rad;
      const sm=sample(px,pz);
      if(sm.biome==='water'||sm.biome==='mountain'||sm.biome==='canyon')return false;
      if(sm.h<WATER_Y+2.0||sm.h>24)return false;
      if(slopeAt(px,pz,4)>slope)return false;      // flat: no hillside, no lip
    }
  }
  // Roads bring everything that can kill you on arrival — the deck itself when
  // it bridges, plus the lamps, billboards and stations that line it. A fuel
  // station is the widest of them, sitting ~12 out with a 12 radius.
  if(roadDist(x,z)<road)return false;
  if(inSettlement(x,z,30))return false;
  return true;
}

/* The run's landing point. Deterministic for a given world: rings and angles are
   walked in a fixed order, so the same seed always starts in the same place.

   Two passes. The first wants real elbow room; the second will accept a tighter
   spot rather than give up, because the fallback — dropping the ship on the raw
   origin — is exactly the bug this module exists to fix, and measured, the
   strict pass alone failed on a third of seeds. */
export function pickSpawn(){
  for(const pass of [[0.20,38],[0.30,26]]){
    for(const rad of RINGS){
      const n=rad===0?1:ANGLES;
      for(let i=0;i<n;i++){
        const a=i/n*Math.PI*2;
        const x=Math.cos(a)*rad, z=Math.sin(a)*rad;
        if(landable(x,z,pass[0],pass[1]))return {x,z,strict:pass[1]===38};
      }
    }
  }
  return {x:0,z:0,strict:false};
}
