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
import { sample, slopeAt, heightAt } from './terrain.js';
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
      /* The ceiling used to be 24, which quietly excluded every dune crest —
         desert ground runs from ~4 in a trough to ~31 on a summit, so the search
         could only ever find pans. Mountains are already excluded by biome, so
         the ceiling only has to stay under the snow line. */
      if(sm.h<WATER_Y+2.0||sm.h>40)return false;
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

/* How much this spot stands ABOVE the country around it: its height less the
   mean of a ring at 40 units. In a dune field that is ~+6 on a crest, ~0 on a
   flank and strongly negative in a trough, so maximising it puts the ship on top
   of a dune with the field falling away on every side — which is the shot the
   arrival film wants, and it is also the safest place to be standing. */
function prominence(x,z){
  const h=heightAt(x,z);
  let sum=0;
  for(let i=0;i<8;i++){
    const a=i/8*Math.PI*2;
    sum+=heightAt(x+Math.cos(a)*40, z+Math.sin(a)*40);
  }
  return h-sum/8;
}

/* The run's landing point. Deterministic for a given world: rings and angles are
   walked in a fixed order, so the same seed always starts in the same place.

   Every legal spot is scored rather than taking the first one found: a dune
   field has plenty of flat ground, and the flattest of it is the bottom of a
   trough — the ship would arrive in a bowl with sand on every horizon. Scoring
   on prominence puts it on a crest instead.

   Two passes. The first wants real elbow room; the second will accept a tighter
   spot rather than give up, because the fallback — dropping the ship on the raw
   origin — is exactly the bug this module exists to fix, and measured, the
   strict pass alone failed on a third of seeds. */
export function pickSpawn(){
  /* The slope limits are looser than they look. A dune's lee face falls away at
     ~0.29 within 19 units of the crest, so the old 0.20 rejected the top of
     every dune and left only the troughs — and a hovering craft does not care
     about a slope underneath it the way a landing one would. What still matters
     (nothing solid nearby, no water, no rock) is unchanged. */
  for(const pass of [[0.32,38],[0.46,26]]){
    let best=null;
    for(const rad of RINGS){
      const n=rad===0?1:ANGLES;
      for(let i=0;i<n;i++){
        const a=i/n*Math.PI*2;
        const x=Math.cos(a)*rad, z=Math.sin(a)*rad;
        if(!landable(x,z,pass[0],pass[1]))continue;
        const p=prominence(x,z);
        if(!best||p>best.p)best={x,z,p};
      }
    }
    if(best)return {x:best.x,z:best.z,strict:pass[1]===38};
  }
  return {x:0,z:0,strict:false};
}

/* Where the AREA 51 sign stands, as a pure function of the landing site.

   It is decided HERE rather than in the chunk builder because the ship's
   starting heading is aimed at it: the sign is the game's opening joke and the
   player has to be looking straight at it when the film hands over, not turning
   round to find it. Chunks.js reads the answer and puts the mesh there.

   Just outside SPAWN_CLEAR, so it cannot be part of an arrival crash, and of
   the angles tried the one that is both level and NOT far below the landing
   site wins — the ship now lands on a dune crest, and a sign sited down the
   lee face would be half-buried behind the brow. */
export function pickSignSpot(sx,sz){
  const base=heightAt(sx,sz);
  let best=null;
  for(let i=0;i<16;i++){
    const a=i/16*Math.PI*2, rad=SPAWN_CLEAR+5;
    const x=sx+Math.cos(a)*rad, z=sz+Math.sin(a)*rad;
    const sm=sample(x,z);
    if(sm.biome==='water'||sm.h<WATER_Y+1.6)continue;
    if(roadDist(x,z)<8)continue;
    // penalise both steep footing and dropping away from the landing site
    const score=slopeAt(x,z,4)*3 + Math.max(0,base-sm.h)*0.35;
    if(!best||score<best.score)best={x,z,h:sm.h,score};
  }
  return best;
}
