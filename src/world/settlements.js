/* =========================================================================
   SETTLEMENTS — villages and cities, scattered widely across the world.

   Scenery only, for now: they are rendered, they light up at night and the
   ambience hears them, but the ship passes straight through. They are
   deliberately kept OUT of the `buildings` registry, which is what
   systems/collision.js scans — being in it is what makes a barn something you
   crash into.

   Placement is DETERMINISTIC, which is the whole trick. A settlement is far
   bigger than a chunk (a city spans four of them), so it cannot be spawned by
   the chunk that happens to load first: every chunk independently asks "which
   settlements overlap me, and which of their buildings fall inside my bounds",
   and gets the same answer every time. Fly away, come back, and the same town
   is standing in the same place with the same streets. Nothing is stored.

   The world is divided into CELL-sized squares; a hash of the cell coordinates
   and the run's seed decides whether a settlement exists there, where in the
   cell it sits, and how big it is. Same idea as the weather field: geography,
   not dice.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { worldSeed } from './noise.js';
import { sample, slopeAt } from './terrain.js';
import { WATER_Y } from '../core/constants.js';
import { disposable } from '../core/dispose.js';
import { windowMat, streetLamp } from '../systems/nightlights.js';
import { roadDist, roadHeightAt, roadSample, wob, ROAD_S, ROAD_HW } from './roads.js';

const CELL      = 1500;   // one settlement slot per 1500x1500 square...
const OCCUPY    = 0.45;   // ...and only this fraction of slots are built on
const CITY_ODDS = 0.22;   // of those, roughly one in five is a city
/* The real built footprints. Kept modest on purpose: every rule below has to
   hold across the WHOLE disc, and a 190-unit circle of flat grass with a road
   through it and no water, rock or sand anywhere in it is vanishingly rare —
   at r=95 a 121-cell census found two towns and no starter city at all. */
const R_VILLAGE = 34;
const R_CITY    = 55;
/* How far outside its own cell a settlement's centre may sit. Normally zero —
   settlementAt keeps a centre inside its cell — but the starter city is pinned
   to the spawn point, and the spawn point is a cell CORNER, so it routinely
   lands in a neighbouring cell. Every cell scan below is widened by this much;
   without it a starter city at negative coordinates was invisible to
   settlementsNear and simply never got built. */
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
  // on-a-road test. roadSample returns the real routed point, so use that.
  const k=Math.round((z-wob(x))/ROAD_S)*ROAD_S;
  const sp=roadSample('x',k,x);
  return {x:sp.x,z:sp.z};
}

/* Is the whole footprint sound? Checked across the disc, not just at the middle:
   flat grass throughout, no water or rock or sand anywhere in it, and no bridge
   deck flying over it. */
function siteOK(x,z,r){
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

/* The run always starts within sight of a city. The home cell is not left to
   the hash: it gets a city planted just over the horizon from the spawn point,
   close enough to see on arrival and reach in a few seconds, far enough that
   the ship does not land in the middle of it.

   Chunk streaming reaches +-280 units (env.VIEW_R 3 x CHUNK 80), so a starter
   city much beyond that would not be loaded when the player lands and looks
   around — and the whole point is to see it on arrival. */
const STARTER_RINGS=[200,235,275,320,375,440,510,600,700,820,940];
function starterCity(){
  /* Graded. The hard rules — grass only, dry, no rock or sand, on a road, no
     bridge overhead — are never relaxed. What gives way is SIZE: if the ground
     near the spawn cannot hold a full city, a compact one is far better than
     none, and the player still gets a skyline to fly over on arrival. Without
     this fallback only 9 seeds in 25 got a starter city at all. */
  // radius, and how far out that pass is willing to look
  for(const pass of [[R_CITY,580],[R_CITY*0.78,580],[R_VILLAGE,620],[R_VILLAGE,980]]){
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
          return {x:c.x,z:c.z,r,city:true,cx:0,cz:0,rot:0.6};
      }
    }
  }
  return null;                       // nowhere sound nearby: no starter city
}

/* The settlement occupying a cell, or null. Pure function of the cell.

   Candidates are tried in a fixed order and the first sound one wins — the
   constraints (flat grass, dry, no rock or sand, no bridge overhead, centred on
   a road) reject most of a cell, so a single hashed guess almost never lands
   anywhere legal. */
const CANDIDATES=26;
const _cache=new Map();
export function settlementAt(cx,cz){
  const key=cx+'|'+cz;
  if(_cache.has(key))return _cache.get(key);
  let s=null;
  if(cx===0&&cz===0){
    s=starterCity();
  }else if(hash(cx,cz,0)<OCCUPY){
    const city=hash(cx,cz,1)<CITY_ODDS;
    const r=city?R_CITY:R_VILLAGE;
    for(let i=0;i<CANDIDATES;i++){
      const gx=cx*CELL+r+hash(cx,cz,20+i)*(CELL-2*r);
      const gz=cz*CELL+r+hash(cx,cz,60+i)*(CELL-2*r);
      const c=snapToRoad(gx,gz);
      if(!siteOK(c.x,c.z,r))continue;
      s={x:c.x,z:c.z,r,city,cx,cz,rot:hash(cx,cz,4)*Math.PI};
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
  let best=1e9, city=false;
  const c0x=Math.floor((x-CELL)/CELL)-CELL_PAD, c0z=Math.floor((z-CELL)/CELL)-CELL_PAD;
  for(let cx=c0x;cx<=c0x+2+2*CELL_PAD;cx++)for(let cz=c0z;cz<=c0z+2+2*CELL_PAD;cz++){
    const s=settlementAt(cx,cz);
    if(!s)continue;
    const d=Math.max(0,Math.hypot(x-s.x,z-s.z)-s.r);
    if(d<best){ best=d; city=s.city; }
  }
  return {d:best,city};
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
  const c0x=Math.floor((ox-R_CITY)/CELL)-CELL_PAD, c1x=Math.floor((ox+w+R_CITY)/CELL)+CELL_PAD;
  const c0z=Math.floor((oz-R_CITY)/CELL)-CELL_PAD, c1z=Math.floor((oz+w+R_CITY)/CELL)+CELL_PAD;
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
   Two silhouettes: a low pitched-roof house for villages, and a flat-topped
   block for cities whose height rises toward the centre, so a city reads as a
   skyline from the air rather than a car park.

   BATCHING. Every building in a chunk is merged into ONE geometry, and every
   window pane into a second. A town is therefore two draw calls no matter how
   many buildings it has — the per-object version measured 714 meshes for a
   single city. Colour rides in a vertex attribute (the same trick the terrain
   uses) so one shared material covers every wall and roof in the world.

   A flat textured slab would be cheaper still, but a city is ~310 units across
   and the ship flies at 15-70 units: from that height you are looking along the
   streets, not down at a map, so the silhouettes have to be real. */

/* Deep and desaturated on purpose. The valley is vivid green and the sun is
   strong, so mid-grey walls washed out to near-white and the towns read as
   polystyrene; at night they stayed bright and swallowed their own lit windows.
   Dark masses with warm glass is the look. */
const WALL=[0x3b4048,0x4a3f38,0x353d44,0x44403a,0x39353c,0x2f3a3f];
const ROOF=[0x6e2f26,0x33404b,0x4d3529,0x2b343b];

const townMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.92,metalness:0.02});

/* Merge scratch. Module-level and reused: a chunk build appends here, then
   flushes into a single mesh. */
const _V=[],_N=[],_C=[],_I=[];
const _mtx=new THREE.Matrix4(), _col=new THREE.Color();
function emit(geo,x,y,z,ry,hex){
  _mtx.makeRotationY(ry||0); _mtx.setPosition(x,y,z);
  geo.applyMatrix4(_mtx);
  _col.setHex(hex);
  const pos=geo.attributes.position, nor=geo.attributes.normal;
  const base=_V.length/3;
  for(let i=0;i<pos.count;i++){
    _V.push(pos.getX(i),pos.getY(i),pos.getZ(i));
    _N.push(nor.getX(i),nor.getY(i),nor.getZ(i));
    _C.push(_col.r,_col.g,_col.b);
  }
  const idx=geo.index;
  if(idx)for(let i=0;i<idx.count;i++)_I.push(base+idx.getX(i));
  else    for(let i=0;i<pos.count;i++)_I.push(base+i);
  geo.dispose();
}
function townMesh(){
  if(!_V.length)return null;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(_V),3));
  geo.setAttribute('normal',  new THREE.BufferAttribute(new Float32Array(_N),3));
  geo.setAttribute('color',   new THREE.BufferAttribute(new Float32Array(_C),3));
  geo.setIndex(_I.slice());
  disposable(geo);
  const m=new THREE.Mesh(geo,townMat);
  m.castShadow=false; m.receiveShadow=true;
  _V.length=0;_N.length=0;_C.length=0;_I.length=0;
  return m;
}

/* Windows.

   Every pane on a building is merged into ONE geometry and drawn with one
   shared material (see nightlights.js), which matters more than it looks: a
   pane-per-mesh version of this measured 714 meshes for a single city, all of
   them separate draw calls. Merged, a whole building is three.

   Panes are accumulated into these module-level scratch arrays and flushed by
   paneMesh(); nothing here allocates per pane. */
const _pv=[], _pi=[];
/* (bx,by,bz,ry) places the building; the rest describes the grid of panes on
   one of its faces. Corners are rotated into place as they are written, so the
   whole town's glass ends up in one buffer. */
function addPanes(bx,by,bz,ry,w,h,z,cols,rows,side){
  const pw=Math.min(0.62,w/(cols*2.1)), ph=Math.min(0.72,h/(rows*2.2));
  const c=Math.cos(ry||0), s=Math.sin(ry||0);
  const push=(lx,ly,lz)=>_pv.push(bx+lx*c+lz*s, by+ly, bz-lx*s+lz*c);
  for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){
    const px=(i-(cols-1)/2)*(w/cols);
    const py=1.0+(j+0.5)*(h/rows)*0.9;
    const b=_pv.length/3;
    if(side){                       // facing +X
      push(z,py-ph/2,px-pw/2); push(z,py-ph/2,px+pw/2);
      push(z,py+ph/2,px+pw/2); push(z,py+ph/2,px-pw/2);
    }else{                          // facing +Z
      push(px-pw/2,py-ph/2,z); push(px+pw/2,py-ph/2,z);
      push(px+pw/2,py+ph/2,z); push(px-pw/2,py+ph/2,z);
    }
    _pi.push(b,b+1,b+2, b,b+2,b+3);
  }
}
function paneMesh(){
  if(!_pv.length)return null;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(_pv),3));
  geo.setIndex(_pi.slice());
  disposable(geo);                  // per-instance: freed when the chunk unloads
  const m=new THREE.Mesh(geo,windowMat());
  m.castShadow=false; m.renderOrder=1;
  _pv.length=0; _pi.length=0;
  return m;
}

/* Both builders append into the shared merge buffers; `bx,by,bz` is the plot in
   chunk-local space and `ry` the building's facing. */
function house(rnd,bx,by,bz,ry){
  const w=3.0+rnd()*1.6, d=2.6+rnd()*1.4, h=2.0+rnd()*0.9;
  const wc=WALL[(rnd()*WALL.length)|0], rc=ROOF[(rnd()*ROOF.length)|0];
  emit(new THREE.BoxGeometry(w,h,d),bx,by+h/2,bz,ry,wc);
  const roof=new THREE.CylinderGeometry(0,Math.max(w,d)*0.78,h*0.62,4);
  roof.scale(1.22,1,1.02); roof.rotateY(Math.PI/4);
  emit(roof,bx,by+h+h*0.31,bz,ry,rc);
  addPanes(bx,by,bz,ry,w*0.7,h*0.6,d/2+0.02,2,1,0);
  addPanes(bx,by,bz,ry,d*0.7,h*0.6,w/2+0.02,2,1,1);
  return h;
}

function block(rnd,k,bx,by,bz,ry){
  // k is 0 at the city edge and 1 dead centre — the skyline comes from this.
  const w=4.5+rnd()*3.5, d=4.0+rnd()*3.0;
  const h=4+rnd()*5+Math.pow(k,1.4)*34;      // low outskirts climbing to a real centre
  const wc=WALL[(rnd()*WALL.length)|0];
  emit(new THREE.BoxGeometry(w,h,d),bx,by+h/2,bz,ry,wc);
  // a slim parapet so the roofline is not a bare cut
  emit(new THREE.BoxGeometry(w*1.04,0.5,d*1.04),bx,by+h+0.2,bz,ry,0x3a3d43);
  const rows=Math.max(2,Math.min(9,Math.round(h/3)));
  addPanes(bx,by,bz,ry,w*0.78,h*0.86,d/2+0.02,Math.max(2,Math.round(w/2.2)),rows,0);
  addPanes(bx,by,bz,ry,d*0.78,h*0.86,w/2+0.02,Math.max(2,Math.round(d/2.2)),rows,1);
  return h;
}

/* ---- instantiation -------------------------------------------------------
   Called once per chunk. Walks every settlement overlapping the chunk and
   emits only the buildings whose own position lands inside it, so a city is
   assembled correctly no matter which corner of it the player approaches from.

   `place(obj,x,z,r)` is supplied by chunks.js: it does the occupancy bookkeeping
   so scenery does not grow through walls. */
export function spawnSettlementParts(ox,oz,size,place){
  const made=[];
  let any=false;
  for(const s of settlementsNear(ox,oz,size)){
    const n=s.city?(44+((hash(s.cx,s.cz,5)*28)|0)):(9+((hash(s.cx,s.cz,5)*6)|0));
    const cos=Math.cos(s.rot), sin=Math.sin(s.rot);
    const lane=s.city?13:15;                 // grid pitch: streets, not fields
    const span=Math.ceil(Math.sqrt(n));
    for(let i=0;i<n;i++){
      // A rotated grid with per-plot jitter: streets, but not graph paper.
      const gx=((i%span)-(span-1)/2)*lane + (hash(s.cx,s.cz,100+i)-0.5)*lane*0.45;
      const gz=(((i/span)|0)-(span-1)/2)*lane + (hash(s.cx,s.cz,300+i)-0.5)*lane*0.45;
      const x=s.x+gx*cos-gz*sin, z=s.z+gx*sin+gz*cos;
      if(x<ox||x>=ox+size||z<oz||z>=oz+size)continue;    // another chunk owns this plot
      const d=Math.hypot(x-s.x,z-s.z);
      if(d>s.r)continue;                                  // trim the grid to a round town
      if(!buildable(x,z,0.40))continue;                   // a pond or a bluff eats this plot
      if(roadDist(x,z)<9)continue;                        // never on the carriageway
      const sm=sample(x,z);
      let rs=hash(s.cx,s.cz,700+i);
      const rnd=()=>{ rs=(rs*16807+0.61803398875)%1; return rs; };
      const k=s.city?Math.max(0,1-d/s.r):0;
      // chunk-local so the merged buffer keeps its float precision far out
      const bx=x-ox, bz=z-oz;
      const ry=s.rot+(hash(s.cx,s.cz,900+i)-0.5)*0.25;
      const by=sm.h-0.6;                     // bedded in: no daylight under the downhill corner
      if(s.city&&rnd()>0.22)block(rnd,k,bx,by,bz,ry); else house(rnd,bx,by,bz,ry);
      any=true;
      place(null,x,z,s.city?5:4);
      // Street lighting: a lamp every few plots, so a town is a constellation
      // from altitude instead of a dark smudge.
      if(hash(s.cx,s.cz,1100+i)<(s.city?0.30:0.20)){
        const lx=x+cos*lane*0.42, lz=z+sin*lane*0.42;
        if(buildable(lx,lz,0.45)&&roadDist(lx,lz)>7){
          const lamp=streetLamp();
          lamp.position.set(lx,sample(lx,lz).h,lz);
          lamp.userData.solid=false;          // scenery for now: nothing to crash into
          made.push(lamp);
          place(lamp,lx,lz,2.0);
        }
      }
    }
  }
  // Flush the batches: the whole chunk's worth of town is two meshes, parented
  // at the chunk origin because everything above was built chunk-local.
  if(any){
    const body=townMesh(), glass=paneMesh();
    for(const m of [body,glass]) if(m){ m.position.set(ox,0,oz); made.unshift(m); }
  }
  return made;
}
