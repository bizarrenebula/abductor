/* =========================================================================
   FIELDS — farmland: crop plots divided by hedgerows.

   The land had no sign of being worked. From the air — the only way this game
   is ever seen — plains read as one continuous carpet, and villages sat on it
   like models on a tablecloth. A patchwork of crop with hedges between it is
   the single strongest "people live off this ground" signal available, and it
   finally gives crop circles something to be drawn IN.

   Placement follows the settlement pattern exactly: a deterministic grid of
   cells, a hash deciding which are farmed, and per-chunk instantiation of
   whatever falls inside. Fly away and back and the same crop is in the same
   plot at the same stage.

   Both layers are batched: one crop mesh and one hedge mesh per chunk however
   many plots it holds. Crop colour and the row striping ride in vertex colours,
   so a single shared material lights and fogs with everything else and no
   custom shader is needed.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { worldSeed } from './noise.js';
import { sample, slopeAt } from './terrain.js';
import { WATER_Y, RESTRICT_R } from '../core/constants.js';
import { disposable } from '../core/dispose.js';
import { roadDist } from './roads.js';
import { inSettlement } from './settlements.js';

/* Plots are small and the grid is tight on purpose. A big rectangle has to be
   homogeneous over its whole footprint, and terrain biome varies far faster
   than that: at 47x30 a census found the biome test alone killing 214 of 440
   candidates and slope another 161, leaving ten. Small plots packed close also
   read better from the air — a patchwork, not isolated rugs. */
const CELL    = 120;     // one plot slot per 120x120 square...
const OCCUPY  = 0.72;    // ...and this fraction of them are farmed
const CELL_PAD= 1;

/* Crop kinds: [wall colour, row colour, hedge?]. The row colour is what the
   striping darkens toward, so the difference between them IS the furrow. */
/* LINEAR values, not hex. renderer.outputEncoding is sRGB, so three.js treats a
   vertex colour as linear and brightens it on the way out — colours picked as
   hex came out as pale rugs dropped on the grass. The terrain writes small
   linear floats directly for the same reason (plains grass is 0.07/0.50/0.12),
   so these are chosen against that scale. `b` is the furrow: the gap between
   the two IS the row. */
const CROPS=[
  {a:[0.50,0.37,0.07], b:[0.30,0.22,0.04]},   // ripe wheat
  {a:[0.62,0.48,0.10], b:[0.38,0.29,0.06]},   // barley
  {a:[0.07,0.38,0.09], b:[0.04,0.22,0.05]},   // young green crop
  {a:[0.20,0.13,0.07], b:[0.12,0.08,0.04]},   // ploughed earth
  {a:[0.40,0.40,0.14], b:[0.24,0.24,0.08]},   // stubble
];

function hash(a,b,k){
  let h=(a*374761393+b*668265263+k*2147483647+worldSeed*2654435761)|0;
  h=Math.imul(h^(h>>>13),1274126177)|0;
  return ((h^(h>>>16))>>>0)/4294967296;
}

/* Farmland only goes on ground you could actually plough. */
function tillable(x,z){
  if(x*x+z*z<RESTRICT_R*RESTRICT_R)return false;   // nothing farmed inside the restricted area
  const sm=sample(x,z);
  if(sm.biome!=='plains'&&sm.biome!=='forest')return false;
  if(sm.h<WATER_Y+2.0||sm.h>26)return false;
  if(slopeAt(x,z,4)>0.34)return false;
  return true;
}

const _cache=new Map();
export function fieldAt(cx,cz){
  const key=cx+'|'+cz;
  if(_cache.has(key))return _cache.get(key);
  let f=null;
  if(hash(cx,cz,0)<OCCUPY){
    const w=22+hash(cx,cz,1)*15, d=16+hash(cx,cz,2)*11;
    const x=cx*CELL+w*0.6+hash(cx,cz,3)*(CELL-w*1.2);
    const z=cz*CELL+d*0.6+hash(cx,cz,4)*(CELL-d*1.2);
    const rot=hash(cx,cz,5)*Math.PI;
    // Every corner and the middle has to be workable, or the plot would run
    // into a lake or up a hillside.
    const c=Math.cos(rot), s=Math.sin(rot);
    let ok=tillable(x,z);
    if(ok)for(const o of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[0,1],[-1,0],[1,0]]){
      const lx=o[0]*w*0.5, lz=o[1]*d*0.5;
      const px=x+lx*c-lz*s, pz=z+lx*s+lz*c;
      if(!tillable(px,pz)||roadDist(px,pz)<9||inSettlement(px,pz,8)){ ok=false; break; }
    }
    if(ok)f={x,z,w,d,rot,cx,cz,crop:CROPS[(hash(cx,cz,6)*CROPS.length)|0],
             rowW:1.8+hash(cx,cz,7)*1.2};
  }
  _cache.set(key,f);
  return f;
}
export function clearFieldCache(){ _cache.clear(); }

/* Is this point inside a plot? Chunk spawners use it to keep trees, animals and
   scenery out of the crop — a wood growing in the middle of a wheat field is
   exactly the sort of thing that gives procedural worlds away. */
export function inField(x,z,pad){
  const p=pad||0;
  const c0x=Math.floor(x/CELL)-CELL_PAD, c0z=Math.floor(z/CELL)-CELL_PAD;
  for(let cx=c0x;cx<=c0x+2*CELL_PAD;cx++)for(let cz=c0z;cz<=c0z+2*CELL_PAD;cz++){
    const f=fieldAt(cx,cz);
    if(!f)continue;
    const dx=x-f.x, dz=z-f.z;
    const c=Math.cos(-f.rot), s=Math.sin(-f.rot);
    const lx=dx*c-dz*s, lz=dx*s+dz*c;     // into the plot's own frame
    if(Math.abs(lx)<f.w*0.5+p&&Math.abs(lz)<f.d*0.5+p)return true;
  }
  return false;
}

export function fieldsNear(ox,oz,size){
  const out=[];
  const c0x=Math.floor(ox/CELL)-CELL_PAD, c1x=Math.floor((ox+size)/CELL)+CELL_PAD;
  const c0z=Math.floor(oz/CELL)-CELL_PAD, c1z=Math.floor((oz+size)/CELL)+CELL_PAD;
  for(let cx=c0x;cx<=c1x;cx++)for(let cz=c0z;cz<=c1z;cz++){
    const f=fieldAt(cx,cz);
    if(f)out.push(f);
  }
  return out;
}

/* ---- batching ------------------------------------------------------------ */
const cropMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0});
/* flatShading because the ribbon shares vertices between its outer wall, top
   and inner wall: averaged normals smoothed the whole thing into a soft berm
   instead of a hedge with a top and two sides. */
const hedgeMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1.0,
  metalness:0,flatShading:true});

// Normals are not accumulated: flush() calls computeVertexNormals(), which is
// both cheaper to write and correct for the terrain-following crop sheet.
const _cv=[],_cc=[],_ci=[];         // crop
const _hv=[],_hc=[],_hi=[];         // hedge

/* One plot's crop: a terrain-following sheet, striped along its rows. Stripes
   are baked into vertex colours rather than a texture or a shader — the mesh is
   already subdivided to follow the ground, so the rows come free and the plot
   still lights and fogs like everything else. */
function emitCrop(f,ox,oz){
  // Along the rows, coarse is fine. ACROSS them the mesh has to carry the
  // furrow, and a stripe whose period is near the vertex spacing moires into
  // wavy blobs — so at least three segments per furrow.
  const SX=Math.max(6,Math.round(f.w/2.4));
  const SZ=Math.max(8,Math.round(f.d/(f.rowW/3)));
  const c=Math.cos(f.rot), s=Math.sin(f.rot);
  const base=_cv.length/3;
  for(let j=0;j<=SZ;j++)for(let i=0;i<=SX;i++){
    const lx=(i/SX-0.5)*f.w, lz=(j/SZ-0.5)*f.d;
    const px=f.x+lx*c-lz*s, pz=f.z+lx*s+lz*c;
    _cv.push(px-ox, sample(px,pz).h+0.14, pz-oz);
    // furrows run along the plot's local X, so the stripe is a function of lz
    const k=Math.abs(Math.sin(lz/f.rowW*Math.PI));
    const ca=f.crop.a, cb=f.crop.b;
    _cc.push(cb[0]+(ca[0]-cb[0])*k, cb[1]+(ca[1]-cb[1])*k, cb[2]+(ca[2]-cb[2])*k);
  }
  for(let j=0;j<SZ;j++)for(let i=0;i<SX;i++){
    const a=base+j*(SX+1)+i, b=a+1, d=a+SX+1, e=d+1;
    _ci.push(a,d,b, b,d,e);
  }
}

/* A run of hedge from (x0,z0) to (x1,z1).

   Built as a continuous RIBBON — two walls and a top, walked along the edge —
   rather than a box per segment. Boxes were the first attempt and read as a row
   of detached slabs however much they overlapped; a ribbon cannot gap because
   consecutive stations share their vertices. Each station takes its own ground
   height and its own height jitter, so the hedge sits on the slope and has an
   uneven top like a real one. */
function emitHedge(x0,z0,x1,z1,ox,oz,seedK,f){
  const len=Math.hypot(x1-x0,z1-z0);
  const n=Math.max(3,Math.round(len/2.2));
  const dx=(x1-x0)/n, dz=(z1-z0)/n;
  const ang=Math.atan2(dx,dz);
  const cx=Math.cos(ang), sx=Math.sin(ang);   // across = (cos, -sin)
  const first=_hv.length/3;
  for(let i=0;i<=n;i++){
    const px=x0+dx*i, pz=z0+dz*i;
    const gy=sample(px,pz).h;
    const hh=1.2+hash(f.cx,f.cz,seedK+i)*0.9;
    const hw=0.32+hash(f.cx,f.cz,seedK+400+i)*0.22;   // a hedge line, not a bank
    // outer-bottom, outer-top, inner-top, inner-bottom
    for(const o of [[-hw,0],[-hw,1],[hw,1],[hw,0]]){
      _hv.push(px+o[0]*cx-ox, gy-0.2+o[1]*(hh+0.2), pz-o[0]*sx-oz);
    }
    const g=0.045+hash(f.cx,f.cz,seedK+800+i)*0.045;
    for(let v=0;v<4;v++)_hc.push(g*0.5,g+0.03,g*0.45);   // linear, and dark: a hedge reads as a shadow line
  }
  for(let i=0;i<n;i++){
    const a=first+i*4, b2=first+(i+1)*4;
    for(let k=0;k<3;k++){          // outer wall, top, inner wall
      _hi.push(a+k,b2+k,a+k+1,  a+k+1,b2+k,b2+k+1);
    }
  }
  // caps, so the ends are not open troughs
  _hi.push(first,first+1,first+2, first,first+2,first+3);
  const l=first+n*4;
  _hi.push(l,l+2,l+1, l,l+3,l+2);
}

function flush(vs,cs,is,mat,ox,oz){
  if(!vs.length)return null;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(vs),3));
  geo.setAttribute('color',   new THREE.BufferAttribute(new Float32Array(cs),3));
  geo.setIndex(is.slice());
  geo.computeVertexNormals();
  disposable(geo);
  const m=new THREE.Mesh(geo,mat);
  m.position.set(ox,0,oz);
  m.castShadow=false; m.receiveShadow=true;
  vs.length=0;cs.length=0;is.length=0;
  return m;
}

/* Called once per chunk. A plot is emitted by the chunk that owns its CENTRE,
   so it is never half-built or built twice; plots are small enough relative to
   the streaming radius that this is invisible. */
export function spawnFieldParts(ox,oz,size){
  const made=[];
  let any=false;
  for(const f of fieldsNear(ox,oz,size)){
    if(f.x<ox||f.x>=ox+size||f.z<oz||f.z>=oz+size)continue;
    emitCrop(f,ox,oz);
    // hedge the perimeter
    const c=Math.cos(f.rot), s=Math.sin(f.rot), hw=f.w*0.5, hd=f.d*0.5;
    const P=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(o=>[
      f.x+o[0]*c-o[1]*s, f.z+o[0]*s+o[1]*c]);
    for(let i=0;i<4;i++){
      const a=P[i], b=P[(i+1)%4];
      emitHedge(a[0],a[1],b[0],b[1],ox,oz,1000+i*90,f);
    }
    any=true;
  }
  if(any){
    const crop=flush(_cv,_cc,_ci,cropMat,ox,oz);
    const hedge=flush(_hv,_hc,_hi,hedgeMat,ox,oz);
    if(crop)made.push(crop);
    if(hedge)made.push(hedge);
  }
  return made;
}
