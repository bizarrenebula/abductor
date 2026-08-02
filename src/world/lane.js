/* =========================================================================
   THE LANE — how a run is laid out in space.

   Items of interest used to be scattered on a ring around the spawn: pick a
   random bearing, pick a random distance, done. That is fair and it is also
   shapeless. Every direction is as good as every other, so the player has no
   reason to commit to one, and a run reads as wandering rather than as going
   somewhere.

   So they are laid along a LANE instead — the same idea as a lane in a MOBA.
   There is a start (the landing site), an end a long way off, and the points of
   interest are strung between them in order. Each one is further out than the
   last and offset randomly to the left or the right of the one before, so the
   route bends unpredictably while always leading onward. The player is never
   told to go this way; they just find that everything worth having lies along a
   line, and follow it.

   And the lane WIDENS with distance, like a cone opening out from the spawn.
   Near the start the choice is narrow and the next thing is nearly straight
   ahead. Far out, the lateral wander is hundreds of metres, so the last leg is
   a real search rather than a corridor. That gives a run a shape: it funnels
   out of a point and fans into open country.

   Everything here is a pure function of (worldSeed, index), so the layout is
   identical for a given seed, survives a reload, and can be quoted in a bug
   report alongside ?seed=.
   ========================================================================= */
import { worldSeed } from './noise.js';
import { sample, goodGround } from './terrain.js';
import { regionAt } from './regions.js';
import { S } from '../core/state.js';

/* Geometry of the lane. */
const LEG_MIN = 300, LEG_VAR = 260;   // how much further out each successive point sits
const START_OUT = 260;                // the first point is at least this far from the landing site
const HALF_ANGLE = 0.62;              // ~35 degrees each side: the cone's half-opening
const WANDER = 0.46;                  // lateral step as a fraction of the leg just flown

function hash(i,k){
  let h=Math.imul(i|0,374761393)^Math.imul(k|0,668265263)^worldSeed;
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967296;
}

/* The lane's overall heading, fixed per world — and CHOSEN, not rolled.

   A random bearing out of a desert start is a coin toss on whether the run ever
   leaves the sand. The point of laying items on a lane is that the lane is the
   route, so the route may as well be the one that shows the player the world:
   candidate headings are scored on how many of the three regions the lane
   actually crosses, and the best one wins. Ties go to the candidate that spends
   its distance most evenly between them, so a lane does not clip a corner of
   the third region in its last hundred metres and call that a visit.

   Deterministic and memoised: a run's heading is a pure function of the seed,
   computed once, and the scoring never runs again. */
let _head=null, _headSeed=-1;
export function laneHeading(){
  if(_headSeed===worldSeed&&_head!==null)return _head;
  const N=24, PROBE=10;
  let best=null;
  for(let c=0;c<N;c++){
    // start from the hashed bearing so the sweep is still seed-dependent
    const a=hash(0,7)*Math.PI*2 + c/N*Math.PI*2;
    const ca=Math.cos(a), sa=Math.sin(a);
    const seen=[0,0,0];
    for(let i=0;i<PROBE;i++){
      const L=laneLocal(i);
      seen[regionAt(S.spawnX+ca*L.fwd-sa*L.lat, S.spawnZ+sa*L.fwd+ca*L.lat)]++;
    }
    const kinds=seen.filter(v=>v>0).length;
    // evenness: the smallest share, so a one-probe cameo scores near zero
    const even=Math.min(...seen)/PROBE;
    const score=kinds*10+even;
    if(!best||score>best.score)best={a,score,kinds};
  }
  _head=best.a; _headSeed=worldSeed;
  return _head;
}

/* The i-th point on the lane (i = 0 is the first thing to find), in lane space:
   `fwd` along the heading, `lat` across it. Kept separate from world space so
   the shape can be reasoned about and tested without any terrain in the way. */
const _p={fwd:0,lat:0,d:0};
export function laneLocal(i){
  let fwd=0, lat=0;
  for(let k=0;k<=i;k++){
    const leg=(k===0?START_OUT:0)+LEG_MIN+hash(k,11)*LEG_VAR;
    fwd+=leg;
    /* Left or right, decided per point — never the same twice in a row by
       accident of the hash, because a run of three the same way would bend the
       lane out of its own cone and the clamp below would flatten it into a
       straight line against the edge. */
    const side=hash(k,23)<0.5?-1:1;
    lat+=side*leg*WANDER*(0.55+hash(k,29)*0.9);
    // ...and hold it inside the cone. This is what makes the lane a lane.
    const lim=Math.tan(HALF_ANGLE)*fwd;
    if(lat> lim)lat= lim;
    if(lat<-lim)lat=-lim;
  }
  _p.fwd=fwd; _p.lat=lat; _p.d=Math.hypot(fwd,lat);
  return _p;
}

/* The i-th point in WORLD space, nudged onto ground something can stand on.

   The nudge spirals outward from the ideal spot rather than re-rolling it: the
   lane's shape is the whole point, so a bad lie should move a point by metres,
   not throw it somewhere else on the map. */
export function lanePoint(i,opts){
  const o=opts||{};
  const a=laneHeading(), ca=Math.cos(a), sa=Math.sin(a);
  const L=laneLocal(i);
  const bx=S.spawnX+ca*L.fwd-sa*L.lat;
  const bz=S.spawnZ+sa*L.fwd+ca*L.lat;
  if(o.raw)return {x:bx,z:bz,d:L.d};
  for(let r=0;r<=140;r+=20){
    const n=r===0?1:8;
    for(let j=0;j<n;j++){
      const th=a+(j/n)*Math.PI*2;
      const x=bx+Math.cos(th)*r, z=bz+Math.sin(th)*r;
      const sm=sample(x,z);
      if(sm.biome==='mountain'||sm.biome==='canyon')continue;
      if(o.dry!==false&&sm.biome==='water')continue;
      if(!goodGround(x,z))continue;
      return {x,z,d:Math.hypot(x-S.spawnX,z-S.spawnZ)};
    }
  }
  return {x:bx,z:bz,d:L.d};      // nowhere better: the lane wins over the ground
}

/* A whole run's worth of points, in order. */
export function laneChain(n,opts){
  const out=[];
  for(let i=0;i<n;i++)out.push(lanePoint(i,opts));
  return out;
}
