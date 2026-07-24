/* =========================================================================
   ROADS — a real, routed road network built as geometry.

   Earlier versions painted roads into the terrain shader. That could never
   route around a mountain (the shader knows nothing about terrain), never lift
   off the ground for a bridge, and always blended into the grass. So the road
   is now a raised ribbon mesh whose centre line is planned here in JS.

   NETWORK
   Corridors still form a grid: roads run along X at every ROAD_S in Z, and
   along Z at every ROAD_S in X. A corridor is identified by (axis, k).

   ROUTING
   The centre line is a pure function of t (the world coordinate along the
   corridor's axis), so any chunk — and every vehicle — derives the identical
   path without needing a shared starting point. The path is solved by a
   dynamic program over candidate sideways offsets, in overlapping blocks;
   see blockOffsets() for why a DP is required rather than a per-step search.

   BRIDGES
   Deck height follows smoothed terrain, but any span near water is lifted to
   a fixed clearance above WATER_Y and the result smoothed again, so approach
   ramps are gradual and the deck never touches the water.

   Everything is cached per (axis,k,i); clearRoadCache() on reseed.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { WATER_Y, MTN_H } from '../core/constants.js';
import { heightAt } from './terrain.js';

export const ROAD_S    = 200;   // spacing between parallel corridors
export const ROAD_HW   = 4.0;   // half-width of the carriageway (thinner; everything
                                // — mesh, stripes, junction node, overpass, verges —
                                // keys off this, so roads stay uniform everywhere)
export const ROAD_LANE = 1.65;  // lane centre offset (vehicles drive here), scaled to fit
export const ROAD_LIFT = 0.30;  // deck sits this far proud of the ground
export const STEP      = 6;     // path sample spacing along a road

const MAXDEV   = 120;   // how far a road may slide sideways to dodge terrain /
                        // find a pass between mountains (wider than before)
const NCAND    = 61;    // candidate offsets (~4u apart) -> caps the bend at ~34deg
const TURN     = 0.3;   // penalty on lateral movement, per unit^2
const BLOCK    = 48;    // steps solved per dynamic-programming block
const MARGIN   = 32;    // look-ahead/behind steps shared with neighbouring blocks
const SMOOTH_N = 3;     // final rounding of the chosen path
const BRIDGE_CLEAR = 4.2;   // deck height above WATER_Y on a water bridge
const WATER_LOOK   = 4;     // steps either side that count as spanning water

// Gentle organic sway so corridors aren't ruler-straight, but small — the road
// gets its real character from routing around terrain, not from a sine wave.
export function wob(t){ return Math.sin(t*0.011)*6 + Math.sin(t*0.023+1.7)*2.5; }

/* ---------- crossroads: overpass vs level junction ----------
   Every grid point (kx,kz) is either a LEVEL crossroad (the two carriageways
   meet flat and traffic may turn between them) or an OVERPASS (one corridor
   humps up and flies over the other; traffic just passes under/over, no turns).
   The choice — and which corridor is on top — is a deterministic hash of the
   grid indices, so it is identical in every chunk and across reloads. */
const OP_CLEAR = 6.5;    // how high the over-road's deck rises above the crossing
const OP_RAMP  = 58;     // half-length of the hump's approach ramp (world units)
const OP_SHARE = 0.42;   // fraction of 4-way crossings built as an overpass

function jhash(a,b){ let h=Math.imul(a|0,73856093)^Math.imul(b|0,19349663); h^=h>>>13; return ((h>>>0)%100000)/100000; }
/* mode for the junction at world grid coords (kx,kz) — both multiples of ROAD_S. */
export function junctionMode(kx,kz){
  const ix=Math.round(kx/ROAD_S), iz=Math.round(kz/ROAD_S);
  if(jhash(ix,iz)<OP_SHARE) return { overpass:true, over: jhash(iz*7+1,ix*13+3)<0.5 ? 'x' : 'z' };
  return { overpass:false };
}
/* Extra deck height for corridor (axis,k) at world coordinate t along its axis,
   from any nearby overpass where THIS corridor is the one on top. A raised-cosine
   hump so vehicles climb a smooth ramp up and over, then settle again. */
export function overpassLift(axis,k,t){
  let lift=0;
  const c0=Math.round(t/ROAD_S)*ROAD_S;
  for(let c=c0-ROAD_S;c<=c0+ROAD_S;c+=ROAD_S){
    const kx=axis==='x'?c:k, kz=axis==='x'?k:c;   // crossing grid point
    const m=junctionMode(kx,kz);
    if(!m.overpass||m.over!==axis)continue;
    const d=Math.abs(t-c);
    if(d<OP_RAMP){ const h=OP_CLEAR*0.5*(1+Math.cos(Math.PI*d/OP_RAMP)); if(h>lift)lift=h; }
  }
  return lift;
}

/* ---------- caches ---------- */
const cCell=new Map(), cBlock=new Map(), cOff=new Map(), cDeck=new Map();
const key=(a,k,i)=>a+'|'+k+'|'+i;
export function clearRoadCache(){ cCell.clear();cBlock.clear();cOff.clear();cDeck.clear();cEdge.clear();cEnv.clear();cWater.clear(); }

/* Point on the corridor's nominal (unrouted) line. */
function base(axis,k,t){
  return axis==='x' ? {x:t, z:k+wob(t)} : {x:k+wob(t), z:t};
}
/* Apply a sideways offset d to a nominal point. */
function shift(axis,p,d){
  return axis==='x' ? {x:p.x, z:p.z+d} : {x:p.x+d, z:p.z};
}
const cand=n=>-MAXDEV+(2*MAXDEV)*n/(NCAND-1);

/* Terrain cost of putting the road at candidate n, step i. */
function cellCost(axis,k,i,n){
  const kk=key(axis,k,i)+':'+n; let v=cCell.get(kk);
  if(v!==undefined)return v;
  const t=i*STEP, d=cand(n);
  const p=shift(axis,base(axis,k,t),d);
  const h=heightAt(p.x,p.z);
  let c=0;
  if(h>6)c+=Math.pow(h-6,1.55);        // climbing is expensive
  if(h>MTN_H)c+=5000;                  // never ride onto a mountain — thread the pass instead
  if(h<WATER_Y)c+=26+(WATER_Y-h)*1.1;  // crossing water is a last resort, not banned
  c+=d*d*0.004;                        // prefer to stay near the corridor
  cCell.set(kk,c);return c;
}

/* Route one block with a dynamic program.

   Choosing each step's offset independently does not work: either side of a
   peak is equally good locally, so the choice flips and any smoothing of those
   choices averages a left detour with a right detour and drives the road
   straight over the summit. The DP instead costs a whole path, with a penalty
   on lateral movement, so it commits to one side and stays there.

   Blocks are solved with a generous MARGIN of shared context on each side, so
   neighbouring blocks see the same obstacle and agree on which way round it —
   without that, a seam appears wherever a block boundary lands mid-detour. */
function blockOffsets(axis,k,b){
  const bk=axis+'|'+k+'|'+b; let v=cBlock.get(bk);
  if(v)return v;
  const i0=b*BLOCK-MARGIN, i1=(b+1)*BLOCK+MARGIN, N=i1-i0+1;
  const f=[],back=[];
  for(let c=0;c<N;c++){f.push(new Float64Array(NCAND));back.push(new Int16Array(NCAND));}
  for(let n=0;n<NCAND;n++)f[0][n]=cellCost(axis,k,i0,n);
  for(let c=1;c<N;c++)for(let n=0;n<NCAND;n++){
    let best=Infinity,bm=n;
    // transitions limited to one candidate per step, which is what bounds the
    // curve radius; the quadratic TURN term then discourages long diagonals
    for(let m=Math.max(0,n-1);m<=Math.min(NCAND-1,n+1);m++){
      const dd=cand(n)-cand(m);
      const val=f[c-1][m]+TURN*dd*dd;
      if(val<best){best=val;bm=m;}
    }
    f[c][n]=best+cellCost(axis,k,i0+c,n);back[c][n]=bm;
  }
  let bn=0,bc=Infinity;
  for(let n=0;n<NCAND;n++)if(f[N-1][n]<bc){bc=f[N-1][n];bn=n;}
  const path=new Int16Array(N);path[N-1]=bn;
  for(let c=N-1;c>0;c--)path[c-1]=back[c][path[c]];
  const out=new Float64Array(BLOCK);
  for(let j=0;j<BLOCK;j++)out[j]=cand(path[MARGIN+j]);
  cBlock.set(bk,out);return out;
}
function rawOffset(axis,k,i){
  const b=Math.floor(i/BLOCK);
  return blockOffsets(axis,k,b)[i-b*BLOCK];
}
/* Final rounding pass over the routed path. */
function offsetAt(axis,k,i){
  const kk=key(axis,k,i); let v=cOff.get(kk);
  if(v!==undefined)return v;
  let sum=0,wsum=0;
  for(let j=-SMOOTH_N;j<=SMOOTH_N;j++){
    const w=1-Math.abs(j)/(SMOOTH_N+1);
    sum+=rawOffset(axis,k,i+j)*w;wsum+=w;
  }
  const o=sum/wsum;
  cOff.set(kk,o);return o;
}
/* Centre-line point at step i, ground level (no deck lift). */
function pathAt(axis,k,i){
  const t=i*STEP;
  return shift(axis,base(axis,k,t),offsetAt(axis,k,i));
}
/* ---------- deck: an engineered, flat grade ----------

   A real road is NOT draped over every bump and dip — it is built to a grade:
   the ground is cut where it rises and filled where it falls, so the deck runs
   level, only easing up or down over long distances to follow the broad lie of
   the land. Draping the deck on the terrain (banking each edge to its own
   ground) made the road ripple with every hillock and sag into every hollow —
   exactly the waviness we want gone.

   So the deck height is a GRADE LINE, computed in two passes:
     1. an upper envelope of the ground across the carriageway, taken over a wide
        window — the road never has to cut into terrain, and small holes/dips are
        simply spanned flat at the level of the surrounding ground.
     2. a wide smoothing of that envelope into a gentle grade, so the flat
        stretches ease into one another instead of stepping.
   Both edges share this one level (no banking), so the road reads as a built,
   flat roadway that touches the ground on the high spots and rides flat — on a
   short embankment or, over real gaps, on piers — across everything lower. */

const ENV_WIN   = 5;   // half-window (steps, ~30u) for the ground upper-envelope —
                       // smaller so the road hugs the ground more and rides on far
                       // less fill (a thinner, more natural profile), while...
const GRADE_WIN  = 9;  // ...this wide easing still keeps the grade smooth, not wavy

/* Left/right edge world position at step i (side = +1 left, -1 right). */
function edgePos(axis,k,i,side){
  const p=pathAt(axis,k,i), pn=pathAt(axis,k,i+1);
  let fx=pn.x-p.x, fz=pn.z-p.z; const l=Math.hypot(fx,fz)||1; fx/=l;fz/=l;
  const nx=fz, nz=-fx;
  return {x:p.x+nx*ROAD_HW*side, z:p.z+nz*ROAD_HW*side};
}
const cEdge=new Map();
function edgeGround(axis,k,i,side){
  const kk=key(axis,k,i)+':'+side; let v=cEdge.get(kk);
  if(v!==undefined)return v;
  const e=edgePos(axis,k,i,side);
  const h=heightAt(e.x,e.z);
  cEdge.set(kk,h);return h;
}
/* Highest ground across the deck's full width at step i (both edges + centre),
   ignoring water depth so a road beside a lake still grades to the shore, not
   the lakebed. */
function crossMax(axis,k,i){
  const p=pathAt(axis,k,i);
  return Math.max(edgeGround(axis,k,i,1), edgeGround(axis,k,i,-1),
                  Math.max(heightAt(p.x,p.z), WATER_Y));
}
/* Upper envelope: the highest cross-section ground within a wide window. Flat
   over dips/holes (they never pull it down), rising only where terrain rises to
   meet the road — so the deck can sit level without terrain poking through. */
const cEnv=new Map();
function envAt(axis,k,i){
  const kk=key(axis,k,i); let v=cEnv.get(kk);
  if(v!==undefined)return v;
  let m=-1e9;
  for(let j=-ENV_WIN;j<=ENV_WIN;j++)m=Math.max(m,crossMax(axis,k,i+j));
  cEnv.set(kk,m);return m;
}
/* Is water anywhere under this span? (For the fixed bridge clearance.) */
const cWater=new Map();
function overWater(axis,k,i){
  const kk=key(axis,k,i); let v=cWater.get(kk);
  if(v!==undefined)return v;
  let w=false;
  for(let j=-WATER_LOOK;j<=WATER_LOOK&&!w;j++){
    const p=pathAt(axis,k,i+j);
    if(heightAt(p.x,p.z)<WATER_Y+0.6)w=true;
  }
  cWater.set(kk,w);return w;
}
/* The flat grade line at step i: the envelope eased over a wide window, lifted
   proud of the ground, and floored to a fixed clearance wherever it spans water.
   One level for the whole carriageway — no banking. */
function deckEdge(axis,k,i){
  const kk=key(axis,k,i); let v=cDeck.get(kk);
  if(v!==undefined)return v;
  let sum=0,wsum=0;
  for(let j=-GRADE_WIN;j<=GRADE_WIN;j++){
    const w=1-Math.abs(j)/(GRADE_WIN+1);
    sum+=envAt(axis,k,i+j)*w;wsum+=w;
  }
  let y=sum/wsum+ROAD_LIFT;
  if(overWater(axis,k,i))y=Math.max(WATER_Y+BRIDGE_CLEAR, y);
  y+=overpassLift(axis,k,i*STEP);   // hump up and over at any overpass we're the top of
  cDeck.set(kk,y);return y;
}
/* Centre-line deck height — what vehicles and the ship ride on. Flat deck, so
   both edges are the same level. */
function deckSmooth(axis,k,i){ return deckEdge(axis,k,i); }

/* ---------- road surface texture ----------
   Built here rather than in world/textures.js because the layout is tied to
   ROAD_HW: U runs ACROSS the carriageway (0 = left shoulder, 1 = right), so
   the stripes land at fixed world offsets no matter how the road meanders.
   V repeats along the road, which is what makes the centre dashes march. */
export const TILE_ALONG = 26;          // world units per vertical texture repeat
const EDGE_LINE = ROAD_HW-1.3;

export const roadTex=(function(){
  const W=192,H=512,c=document.createElement('canvas');
  c.width=W;c.height=H;const x=c.getContext('2d');
  const u=off=>((off+ROAD_HW)/(2*ROAD_HW))*W;
  x.fillStyle='#5b5f66';x.fillRect(0,0,W,H);                 // asphalt base
  for(let i=0;i<9000;i++){                                    // aggregate speckle
    const l=64+Math.random()*105,r=0.5+Math.random()*1.9;
    x.fillStyle='rgba('+(l|0)+','+(l|0)+','+(l*1.05|0)+','+(0.14+Math.random()*0.34)+')';
    x.beginPath();x.arc(Math.random()*W,Math.random()*H,r,0,7);x.fill();
  }
  for(let i=0;i<20;i++){                                      // tar patches
    x.fillStyle='rgba(46,49,54,'+(0.14+Math.random()*0.2)+')';
    x.beginPath();x.ellipse(Math.random()*W,Math.random()*H,8+Math.random()*26,10+Math.random()*40,Math.random()*3,0,7);x.fill();
  }
  for(let i=0;i<7;i++){                                       // repair seams
    x.strokeStyle='rgba(40,42,47,0.5)';x.lineWidth=1+Math.random()*1.5;
    x.beginPath();let py=Math.random()*H;x.moveTo(0,py);
    for(let k=0;k<5;k++){py+=(Math.random()-0.5)*40;x.lineTo(W*(k+1)/5,py);}x.stroke();
  }
  x.fillStyle='rgba(30,28,24,0.55)';                          // gritty shoulders
  x.fillRect(0,0,u(-ROAD_HW+0.9),H);x.fillRect(u(ROAD_HW-0.9),0,W,H);
  x.fillStyle='#cfcbb6';                                      // solid edge stripes
  for(const o of [-EDGE_LINE,EDGE_LINE])x.fillRect(u(o)-2.5,0,5,H);
  for(let y=0;y<H;y+=256)x.fillRect(u(0)-3,y,6,150);          // dashed centre line
  x.globalCompositeOperation='multiply';                      // wear the paint back
  for(let i=0;i<2200;i++){
    const l=110+Math.random()*145;
    x.fillStyle='rgba('+(l|0)+','+(l|0)+','+(l|0)+',0.30)';
    x.fillRect(Math.random()*W,Math.random()*H,2,2);
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=THREE.ClampToEdgeWrapping;      // never wrap across the width
  t.wrapT=THREE.RepeatWrapping;           // repeat along the length
  t.anisotropy=16;
  return t;
})();

/* Plain asphalt with NO lane/edge markings, for the intersection node where two
   carriageways meet. Same base tone and speckle as roadTex so a junction pad
   reads as the identical road surface — just unmarked, the way the middle of a
   real crossroads is. Tiles in both directions so the pad can repeat cleanly. */
export const junctionTex=(function(){
  const S=128,c=document.createElement('canvas');
  c.width=S;c.height=S;const x=c.getContext('2d');
  x.fillStyle='#5b5f66';x.fillRect(0,0,S,S);                  // asphalt base
  for(let i=0;i<3600;i++){                                     // aggregate speckle
    const l=64+Math.random()*105,r=0.5+Math.random()*1.9;
    x.fillStyle='rgba('+(l|0)+','+(l|0)+','+(l*1.05|0)+','+(0.14+Math.random()*0.34)+')';
    x.beginPath();x.arc(Math.random()*S,Math.random()*S,r,0,7);x.fill();
  }
  for(let i=0;i<10;i++){                                       // tar patches
    x.fillStyle='rgba(46,49,54,'+(0.14+Math.random()*0.2)+')';
    x.beginPath();x.ellipse(Math.random()*S,Math.random()*S,6+Math.random()*18,7+Math.random()*22,Math.random()*3,0,7);x.fill();
  }
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=16;
  return t;
})();

/* ---------- public sampling (used by vehicles) ---------- */
/* Position + heading on the centre line at world coordinate t along the axis. */
export function roadSample(axis,k,t){
  const fi=t/STEP, i=Math.floor(fi), f=fi-i;
  const a=pathAt(axis,k,i), b=pathAt(axis,k,i+1);
  const x=a.x+(b.x-a.x)*f, z=a.z+(b.z-a.z)*f;
  const ya=deckSmooth(axis,k,i), yb=deckSmooth(axis,k,i+1);
  const y=ya+(yb-ya)*f;
  let fx=b.x-a.x, fz=b.z-a.z;
  const l=Math.hypot(fx,fz)||1; fx/=l; fz/=l;
  return {x,z,y,fx,fz};
}

/* Deck height at an arbitrary world point, or -Infinity if not over a road.

   Cheap because a corridor's path parameter IS the world coordinate along its
   axis: only the handful of corridors whose k could reach this point need
   testing, and each is a single sample. Used so the ship rides over roads and
   bridges instead of through them. */
function nearestRoad(x,z){
  let bd=Infinity, by=-Infinity;
  for(const axis of ['x','z']){
    const c=(axis==='x')?z:x, t=(axis==='x')?x:z;
    const k0=Math.ceil((c-MAXDEV-ROAD_HW)/ROAD_S)*ROAD_S;
    for(let k=k0;k<=c+MAXDEV+ROAD_HW;k+=ROAD_S){
      const sp=roadSample(axis,k,t);
      const d=Math.hypot(sp.x-x,sp.z-z);
      if(d<bd){bd=d;by=sp.y;}
    }
  }
  return {d:bd,y:by};
}
export function roadHeightAt(x,z){
  const n=nearestRoad(x,z);
  return n.d<ROAD_HW+1.2 ? n.y : -Infinity;
}
/* Horizontal distance to the nearest carriageway centre line, or Infinity.
   Used to keep scenery off the tarmac and its verges. */
export function roadDist(x,z){ return nearestRoad(x,z).d; }

/* ---------- crossroads ----------
   The network is a grid, so an X-corridor (k=kz) and a Z-corridor (k=kx) meet
   near each grid point (kx,kz). Because both are routed sideways to dodge
   terrain, the actual crossing is offset from the grid point, so we scan the
   X-road near t=kx and find where it comes closest to the Z-road (same z), and
   report that as the junction centre + the road heading there. One entry per
   grid point inside the chunk, so junctions aren't rendered twice. */
export function junctionsIn(ox,oz,size){
  const out=[];
  const kx0=Math.ceil(ox/ROAD_S)*ROAD_S, kz0=Math.ceil(oz/ROAD_S)*ROAD_S;
  for(let kx=kx0;kx<ox+size;kx+=ROAD_S)for(let kz=kz0;kz<oz+size;kz+=ROAD_S){
    let best=Infinity,bx=0,bz=0,by=0,ang=0;
    for(let t=kx-90;t<=kx+90;t+=STEP){
      const a=roadSample('x',kz,t);        // X-road point
      const b=roadSample('z',kx,a.z);      // Z-road point at the same z
      const d=Math.abs(a.x-b.x);
      if(d<best){best=d;bx=(a.x+b.x)*0.5;bz=a.z;by=Math.max(a.y,b.y);ang=Math.atan2(a.fx,a.fz);}
    }
    if(best<ROAD_HW*1.7){
      const m=junctionMode(kx,kz);
      out.push({x:bx,y:by,z:bz,ang,overpass:m.overpass,over:m.over});   // they really meet -> a junction
    }
  }
  return out;
}

/* ---------- which corridors touch a chunk ---------- */
export function roadsNear(ox,oz,size){
  const out=[], pad=MAXDEV+22;
  for(const axis of ['x','z']){
    const lo=(axis==='x'?oz:ox)-pad, hi=(axis==='x'?oz:ox)+size+pad;
    const k0=Math.ceil(lo/ROAD_S), k1=Math.floor(hi/ROAD_S);
    for(let n=k0;n<=k1;n++)out.push({axis,k:n*ROAD_S});
  }
  return out;
}

/* ---------- mesh ---------- */
/* Ribbon deck + vertical skirts, so the road reads as a raised surface with
   thickness rather than a decal blended into the grass. Bridge spans also get
   piers dropped to the riverbed. */
export function buildRoadMesh(axis,k,t0,t1,deckMat,pierMat){
  const i0=Math.floor(t0/STEP)-1, i1=Math.ceil(t1/STEP)+1;
  const pos=[],uv=[],idx=[];
  const SLAB=0.4, MAXFILL=1.5;      // thin deck edge; low embankment fills to ground up to
                                    // MAXFILL, beyond that it's a bridge/overpass on piers
  let along=0, vbase=0;
  const grp=new THREE.Group();

  for(let i=i0;i<=i1;i++){
    const p=pathAt(axis,k,i);
    const pn=pathAt(axis,k,i+1);
    let fx=pn.x-p.x, fz=pn.z-p.z; const l=Math.hypot(fx,fz)||1; fx/=l;fz/=l;
    const nx=fz, nz=-fx;                       // left normal
    // Flat grade: both edges share one level, so the carriageway is level
    // across its width (no bank) and level along the flats, easing only over
    // long distances. Terrain is met by a fill skirt, gaps by piers.
    const lx=p.x+nx*ROAD_HW, lz=p.z+nz*ROAD_HW;
    const rx=p.x-nx*ROAD_HW, rz=p.z-nz*ROAD_HW;
    const y=deckEdge(axis,k,i);
    const ly=y, ry=y;
    // A shallow fill reaches the ground as a low embankment; once the deck sits
    // well clear of the ground it's a bridge/overpass, carried as a THIN deck
    // slab on piers rather than a tall solid wall (which read as a chunky slab).
    const lg=heightAt(lx,lz), rg=heightAt(rx,rz);
    const lfill=ly-lg, rfill=ry-rg;
    const lb = lfill<=MAXFILL ? lg-0.25 : ly-SLAB;
    const rb = rfill<=MAXFILL ? rg-0.25 : ry-SLAB;
    pos.push(lx, ly, lz);
    pos.push(rx, ry, rz);
    pos.push(lx, lb, lz);
    pos.push(rx, rb, rz);
    uv.push(0,along, 1,along, 0,along, 1,along);
    if(i>i0){
      const a=vbase-4, b=vbase;
      // Winding matters: with the deck wound the other way its normal points
      // DOWN and the whole carriageway is backface-culled, leaving only the
      // skirts visible edge-on — a thin dark line instead of a road.
      idx.push(a,a+1,b,  b,a+1,b+1);           // deck (faces up)
      idx.push(a+2,b+2,a, a,b+2,b);            // outer skirt
      idx.push(a+1,a+3,b+1, a+3,b+3,b+1);      // inner skirt
    }
    vbase+=4;
    along+=STEP/TILE_ALONG;

    // A pier goes in where the deck has risen past the embankment reach on both
    // edges — a genuine bridge/overpass span, carried on slim pillars.
    if(i%4===0 && lfill>MAXFILL && rfill>MAXFILL){
      const gh=Math.min(heightAt(p.x,p.z),lg,rg);
      const hgt=y-gh;
      if(hgt>MAXFILL){
        const pier=new THREE.Mesh(new THREE.BoxGeometry(0.8,hgt,0.8),pierMat);
        pier.position.set(p.x,gh+hgt/2,p.z);
        pier.rotation.y=Math.atan2(fx,fz);
        grp.add(pier);
      }
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const deck=new THREE.Mesh(geo,deckMat);
  deck.receiveShadow=true;
  grp.add(deck);
  return grp;
}
