/* =========================================================================
   SETTLEMENTS — villages of six or seven houses, scattered across the world.

   Scenery only, for now: they are rendered, they light up at night and the
   ambience hears them, but the ship passes straight through. They are
   deliberately kept OUT of the `buildings` registry, which is what
   systems/collision.js scans — being in it is what makes a barn something you
   crash into.

   Placement is DETERMINISTIC, which is the whole trick. A village can straddle
   a chunk boundary, so it cannot belong to whichever chunk loads first: every
   chunk independently asks "which villages overlap me, and which of their
   houses fall inside my bounds", and gets the same answer every time. Fly away,
   come back, and the same village is standing in the same place, same houses,
   same colours. Nothing is stored.

   The world is divided into CELL-sized squares; a hash of the cell coordinates
   and the run's seed decides whether a settlement exists there, where in the
   cell it sits. Same idea as the weather field: geography, not dice.
   ========================================================================= */
import { worldSeed } from './noise.js';
import { sample, slopeAt } from './terrain.js';
import { WATER_Y, RESTRICT_R } from '../core/constants.js';
import { streetLamp } from '../systems/nightlights.js';
import { buildBuilding } from '../entities/humans.js';
import { roadDist, roadHeightAt, roadSample, wob, ROAD_S, ROAD_HW, kIndex, kAt } from './roads.js';

const CELL      = 1100;   // one village slot per 1100x1100 square...
const OCCUPY    = 0.55;   // ...and only this fraction of slots are built on
/* A village is six or seven houses, so the footprint is small — which matters:
   every rule below has to hold across the WHOLE disc, and a large circle of
   flat grass with a road through it and no water, rock or sand anywhere in it
   is vanishingly rare. An earlier r=95 "city" gave two towns in a 121-cell
   census; at this size they are common. */
const R_TOWN    = 34;
const CELL_PAD  = 1;

/* Uniform, stable hash of (cell x, cell z, index). Deterministic per run and
   per place; `k` indexes the different decisions a settlement needs. */
function hash(a,b,k){
  let h=(a*374761393+b*668265263+k*2147483647+worldSeed*2654435761)|0;
  h=Math.imul(h^(h>>>13),1274126177)|0;
  return ((h^(h>>>16))>>>0)/4294967296;
}

/* Can a single building stand here? Grass only — no sand, no rock, no water —
   on gentle ground, clear of the carriageway. */
function buildable(x,z,slope){
  const sm=sample(x,z);
  if(sm.biome!=='plains'&&sm.biome!=='forest')return false;   // grass; excludes desert
  if(sm.h<WATER_Y+2.0||sm.h>24)return false;
  if(slopeAt(x,z,4)>(slope||0.34))return false;
  return true;
}

/* Put a point on the nearest east-west corridor. A corridor at k has the line
   z = k + wob(x), so this is exact. Towns are CENTRED on a road rather than
   merely near one, which is what makes the road enter one side and leave the
   other with the streets running through the middle — and it is what the
   traffic system then drives along, since vehicles spawn on roads. */
function snapToRoad(x,z){
  // wob() is only the FIRST half of a corridor's routing — offsetAt() then shifts
  // it sideways to dodge terrain, by up to MAXDEV. Snapping to the nominal line
  // therefore missed the actual tarmac and almost every candidate failed the
  // on-a-road test. roadSample returns the real routed point AND its heading,
  // which is what lets the houses line the road instead of ignoring it.
  const k=kAt(kIndex(z-wob(x)));
  const sp=roadSample('x',k,x);
  return {x:sp.x,z:sp.z,fx:sp.fx,fz:sp.fz};
}

/* Is the whole footprint sound? Checked across the disc, not just at the middle:
   flat grass throughout, no water or rock or sand anywhere in it, and no bridge
   deck flying over it. */
function siteOK(x,z,r){
  // The restricted area around the landing site is off limits to settlement.
  if(Math.hypot(x,z)<RESTRICT_R+r)return false;
  /* Terrain first, roads second. The terrain tests are pure noise evaluations;
     the road tests walk a routed path and populate a cache. Most candidates die
     on the terrain, so asking the cheap question first keeps the road machinery
     out of the vast majority of rejections. */
  for(const ring of [[0,1],[r*0.4,8],[r*0.7,10],[r*0.95,12]]){
    const rad=ring[0], n=ring[1];
    for(let i=0;i<n;i++){
      const a=n===1?0:i/n*Math.PI*2;
      const px=x+Math.cos(a)*rad, pz=z+Math.sin(a)*rad;
      const sm=sample(px,pz);
      if(sm.biome!=='plains'&&sm.biome!=='forest')return false;   // grass only
      if(sm.h<WATER_Y+2.5||sm.h>26)return false;                  // dry, low ground
      if(slopeAt(px,pz,5)>0.30)return false;                      // flat
    }
  }
  if(roadDist(x,z)>ROAD_HW+3)return false;                        // must sit on its road
  // No bridge deck flying over the town: sample along the street and at the rim.
  for(const o of [[0,0],[r*0.5,0],[-r*0.5,0],[r*0.95,0],[-r*0.95,0],
                  [0,r*0.5],[0,-r*0.5],[0,r*0.95],[0,-r*0.95]]){
    const px=x+o[0], pz=z+o[1];
    const rh=roadHeightAt(px,pz);
    // >4.5 means a real deck overhead, not the embankment every road builds as
    // it smooths over rolling ground — an overpass clears its crossing by 6.5.
    if(rh>-Infinity&&rh-sample(px,pz).h>4.5)return false;
  }
  return true;
}

/* The run always starts within sight of a village. The home cell is not left
   to the hash: it gets one planted just over the horizon from the spawn point,
   close enough to see on arrival and reach in a few seconds, far enough that
   the ship does not land in the middle of it.

   Chunk streaming reaches +-280 units (env.VIEW_R 3 x CHUNK 80), so a starter
   village much beyond that would not be loaded when the player lands and looks
   around — and the whole point is to see it on arrival. */
const STARTER_RINGS=[200,235,275,320,375,440,510,600,700,820,940];
function starterCity(){
  /* Graded. The hard rules — grass only, dry, no rock or sand, on a road, no
     bridge overhead — are never relaxed. What gives way is SIZE: if the ground
     near the spawn cannot hold a full city, a compact one is far better than
     none, and the player still gets a skyline to fly over on arrival. Without
     this fallback only 9 seeds in 25 got a starter city at all. */
  for(const pass of [[R_TOWN,560],[R_TOWN,980]]){
    const r=pass[0], far=pass[1];
    for(const dist of STARTER_RINGS){
      if(dist>far)break;
      for(let i=0;i<24;i++){
        const a=i/24*Math.PI*2;
        const c=snapToRoad(Math.cos(a)*dist,Math.sin(a)*dist);
        // snapping moves it onto the road, so re-check it did not land on top of
        // the spawn point (or so far off that it is out of streaming range)
        const d=Math.hypot(c.x,c.z);
        if(d<r+60||d>far)continue;
        if(siteOK(c.x,c.z,r))
          return {x:c.x,z:c.z,r,cx:0,cz:0,fx:c.fx,fz:c.fz};
      }
    }
  }
  return null;                       // nowhere sound nearby: no starter village
}

/* The settlement occupying a cell, or null. Pure function of the cell.

   Candidates are tried in a fixed order and the first sound one wins — the
   constraints (flat grass, dry, no rock or sand, no bridge overhead, centred on
   a road) reject most of a cell, so a single hashed guess almost never lands
   anywhere legal. */
const CANDIDATES=20;
const _cache=new Map();
export function settlementAt(cx,cz){
  const key=cx+'|'+cz;
  if(_cache.has(key))return _cache.get(key);
  let s=null;
  if(cx===0&&cz===0){
    s=starterCity();
  }else if(hash(cx,cz,0)<OCCUPY){
    const r=R_TOWN;
    for(let i=0;i<CANDIDATES;i++){
      const gx=cx*CELL+r+hash(cx,cz,20+i)*(CELL-2*r);
      const gz=cz*CELL+r+hash(cx,cz,60+i)*(CELL-2*r);
      const c=snapToRoad(gx,gz);
      if(!siteOK(c.x,c.z,r))continue;
      s={x:c.x,z:c.z,r,cx,cz,fx:c.fx,fz:c.fz};
      break;
    }
  }
  _cache.set(key,s);
  return s;
}
export function clearSettlementCache(){ _cache.clear(); }

/* Distance from a point to the nearest town's edge (0 inside it), and how big
   that town is. The ambience uses this instead of counting buildings: the
   buildings are batched into per-chunk meshes now, so their positions are chunk
   origins rather than doorsteps, and a town's centre is the better cue anyway. */
export function nearestTown(x,z){
  let best=1e9;
  const c0x=Math.floor((x-CELL)/CELL)-CELL_PAD, c0z=Math.floor((z-CELL)/CELL)-CELL_PAD;
  for(let cx=c0x;cx<=c0x+2+2*CELL_PAD;cx++)for(let cz=c0z;cz<=c0z+2+2*CELL_PAD;cz++){
    const s=settlementAt(cx,cz);
    if(!s)continue;
    const d=Math.max(0,Math.hypot(x-s.x,z-s.z)-s.r);
    if(d<best)best=d;
  }
  return {d:best};
}

/* Is this point inside a town? Used by the chunk spawners to keep everything
   else — trees, animals, crystals, farm buildings, billboards, stations — out
   of a settlement. Roads and their traffic are deliberately NOT filtered: the
   street through the middle and the vehicles on it are the point. */
export function inSettlement(x,z,pad){
  const p=pad||0;
  const c0x=Math.floor((x-CELL)/CELL)-CELL_PAD, c0z=Math.floor((z-CELL)/CELL)-CELL_PAD;
  for(let cx=c0x;cx<=c0x+2+2*CELL_PAD;cx++)for(let cz=c0z;cz<=c0z+2+2*CELL_PAD;cz++){
    const s=settlementAt(cx,cz);
    if(!s)continue;
    const rr=s.r+p;
    if((x-s.x)**2+(z-s.z)**2<rr*rr)return true;
  }
  return false;
}

/* Every town whose CENTRE lies within `range` of a point — what the minimap
   wants, since it draws off-range towns as edge markers rather than dropping
   them. Reuses one array; the caller must not hold on to it. */
const _tw=[];
export function townsWithin(x,z,range){
  _tw.length=0;
  const c0x=Math.floor((x-range)/CELL)-CELL_PAD, c1x=Math.floor((x+range)/CELL)+CELL_PAD;
  const c0z=Math.floor((z-range)/CELL)-CELL_PAD, c1z=Math.floor((z+range)/CELL)+CELL_PAD;
  for(let cx=c0x;cx<=c1x;cx++)for(let cz=c0z;cz<=c1z;cz++){
    const s=settlementAt(cx,cz);
    if(s&&(s.x-x)**2+(s.z-z)**2<=range*range)_tw.push(s);
  }
  return _tw;
}

/* Every settlement whose footprint could reach into the box (ox,oz)-(ox+w,oz+w). */
export function settlementsNear(ox,oz,w){
  const out=[];
  const c0x=Math.floor((ox-R_TOWN)/CELL)-CELL_PAD, c1x=Math.floor((ox+w+R_TOWN)/CELL)+CELL_PAD;
  const c0z=Math.floor((oz-R_TOWN)/CELL)-CELL_PAD, c1z=Math.floor((oz+w+R_TOWN)/CELL)+CELL_PAD;
  for(let cx=c0x;cx<=c1x;cx++)for(let cz=c0z;cz<=c1z;cz++){
    const s=settlementAt(cx,cz);
    if(!s)continue;
    // circle vs box
    const nx=Math.max(ox,Math.min(s.x,ox+w)), nz=Math.max(oz,Math.min(s.z,oz+w));
    if((nx-s.x)**2+(nz-s.z)**2<=s.r*s.r)out.push(s);
  }
  return out;
}

/* ---- the buildings themselves -------------------------------------------
   No bespoke geometry here any more. A village is a cluster of the game's
   existing house — same model the farms use, so settlements look like they
   belong to the same world rather than a different art pass — varied by
   rotation, a little scale and the house palette. That is enough: an earlier
   version generated tower blocks with merged window grids, which read as a
   different game.

   Everything is keyed off the settlement's hash, including the colour index
   (buildBuilding takes one), so a village that unloads and reloads comes back
   identical rather than repainting itself. */

/* ---- instantiation -------------------------------------------------------
   Called once per chunk. Walks every settlement overlapping the chunk and
   emits only the houses whose own position lands inside it, so a village is
   assembled correctly no matter which side the player approaches from.

   `place(obj,x,z,r)` is supplied by chunks.js: it does the occupancy bookkeeping
   so scenery does not grow through walls. */
export function spawnSettlementParts(ox,oz,size,place){
  const made=[];
  for(const s of settlementsNear(ox,oz,size)){
    const n=5+((hash(s.cx,s.cz,5)*3)|0);        // 5-7 houses: a hamlet, not a town
    /* Houses LINE the road, alternating sides, rather than filling a square
       grid. A grid centred on a road puts its middle row on the tarmac, and the
       carriageway clearance below then deletes it — a six-house village came out
       with one house standing. Flanking the road also happens to be how small
       settlements actually grow. */
    const fx=s.fx, fz=s.fz;                     // road forward
    const rx=fz, rz=-fx;                        // road right
    for(let i=0;i<n;i++){
      const along=((i-(n-1)/2)*12)+(hash(s.cx,s.cz,100+i)-0.5)*6;
      const side=(i%2)?1:-1;
      const off=side*(12+hash(s.cx,s.cz,300+i)*6);          // clear of the verge
      const x=s.x+fx*along+rx*off, z=s.z+fz*along+rz*off;
      if(x<ox||x>=ox+size||z<oz||z>=oz+size)continue;    // another chunk owns this plot
      if(Math.hypot(x-s.x,z-s.z)>s.r+6)continue;
      if(!buildable(x,z,0.40))continue;                  // a pond or a bluff eats this plot
      if(roadDist(x,z)<9)continue;                       // never on the carriageway
      const b=buildBuilding('house',(hash(s.cx,s.cz,500+i)*97)|0);
      b.position.set(x,sample(x,z).h-0.25,z);            // bedded in, no floating corner
      // face the road, with a little slop so the row is not machined
      b.rotation.y=Math.atan2(-rx*side,-rz*side)+(hash(s.cx,s.cz,900+i)-0.5)*0.5;
      b.scale.multiplyScalar(0.86+hash(s.cx,s.cz,1300+i)*0.42);
      b.userData.solid=false;                            // scenery: nothing to crash into
      made.push(b);
      place(b,x,z,4);
    }
    // One lamp on the village street, so it is a light in the dark from above.
    const lx=s.x+rx*9.5, lz=s.z+rz*9.5;
    if(buildable(lx,lz,0.45)){
      const lamp=streetLamp();
      lamp.position.set(lx,sample(lx,lz).h,lz);
      lamp.rotation.y=Math.atan2(-rx,-rz);
      lamp.userData.solid=false;
      if(lx>=ox&&lx<ox+size&&lz>=oz&&lz<oz+size){ made.push(lamp); place(lamp,lx,lz,2.0); }
    }
  }
  return made;
}
