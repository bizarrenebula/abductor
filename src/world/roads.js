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
import { WATER_Y, MTN_H, RESTRICT_R } from '../core/constants.js';
import { heightAt } from './terrain.js';
import { regionWeights } from './regions.js';
import { smoothstep } from '../core/math.js';

/* ---------- where roads exist at all ----------
   Roads belong to the URBAN region and nowhere else. The corridor grid is still
   global — it has to be, or a road could not run from one town to the next — but
   only the stretches crossing urban ground are built, populated and reported.
   Everywhere else the network is a line on a map that was never surfaced.

   Everything keys off roadDist(), which returns Infinity off-network, so the
   dozens of "keep clear of the tarmac" tests scattered through the world
   builders all follow automatically without knowing why. */
/* How much road there is at a point, 0..1 — a WIDTH, not a yes/no.

   The first version of this was a boolean and it looked exactly as bad as it
   sounds: a full-width carriageway running at speed into the edge of the
   desert and stopping square, mid-nowhere, with the sand carrying on. A road
   that ends has to end like a road ends — narrowing to a track, then to a pair
   of ruts, then to nothing. So the deck's half-width is scaled by this and the
   last stretch tapers itself out.

   The three lands get three different networks:

     URBAN      the full grid. This is the region that HAS roads.
     WILDERNESS one corridor in three, hashed on (axis,k) so it is the same
                corridors every time — the lanes that carry on out of town
                toward the next one, rather than a grid nobody built.
     DESERT     none, ever.

   Because a wilderness lane is the same corridor as the urban one it continues,
   a road leaving town keeps going into the country and only gives out where the
   sand starts. That is what stops it ending in nothing. */
const WILD_SHARE = 0.34;      // fraction of corridors that carry on into wilderness

/* ---- TRUNK ROADS: the desert crossings ----------------------------------
   A desert used to sever the network. Measured over a 6.4km box, the world came
   out as 12 disconnected road components with the largest holding only 63% of
   the tarmac — every sand blob cut whatever ran into it.

   So a sparse subset of corridors are TRUNKS, and a trunk keeps its surface all
   the way across the sand. It is the one road in and the one road out: no side
   turnings, no grid, just a line of tarmac between the dunes with nothing on it.

   Trunks are X-AXIS ONLY, deliberately. Allow both axes and two trunks
   eventually cross INSIDE a desert, which gives you a junction in the middle of
   the sand and turns "a single road in and out" into a crossroads that leads
   nowhere twice. One axis makes that impossible by construction rather than by
   a test, and costs only that desert crossings all run roughly east-west —
   which is consistent with the world already having one fixed dune direction.

   1 in 9 of the X corridors, so a trunk every ~2.7km: a typical desert gets one
   crossing, a wide one gets two. */
const TRUNK_SHARE = 0.11;
export function corridorIsTrunk(axis,k){
  if(axis!=='x')return false;
  let h=Math.imul((k/ROAD_S)|0,2246822519)^0x27d4eb2f;
  h=Math.imul(h^(h>>>15),1274126177);
  return (((h^(h>>>16))>>>0)/4294967296)<TRUNK_SHARE;
}

export function corridorRuns(axis,k){
  // deterministic per corridor, and stable across chunks and reloads
  let h=Math.imul((k/ROAD_S)|0,668265263)^(axis==='x'?0x9e3779b9:0x85ebca6b);
  h=Math.imul(h^(h>>>13),1274126177);
  return (((h^(h>>>16))>>>0)/4294967296)<WILD_SHARE;
}
/* The taper. 1 in full urban, easing to 0 through the blend; in wilderness the
   same but only for corridors that run, and capped a little narrower because a
   country lane is not a town street. Desert is hard zero. */
export function roadWidth(x,z,axis,k){
  const W=regionWeights(x,z);
  /* The sand fade has to be GRADUAL. A hard cut-off measured out at a median
     ending width of 1.0 — every road in the world stopping at full width, which
     is precisely the thing that looked wrong. Tapering across the blend band
     instead means the tarmac narrows to a track, then to a pair of ruts, then to
     nothing, the way a road actually gives out at the edge of a desert. */
  const sand=1-smoothstep(0.10,0.40,W.des);
  /* A trunk ignores the sand entirely — that is what makes it a crossing. It
     runs narrow out here (0.5): a single carriageway between the dunes, not a
     town street that happens to be in a desert. */
  if(axis!==undefined&&corridorIsTrunk(axis,k))
    return Math.max(smoothstep(0.22,0.58,W.urb),0.50);
  if(sand<=0)return 0;
  const urb=smoothstep(0.22,0.58,W.urb);
  const runs=(axis===undefined)||corridorRuns(axis,k);
  /* 0.62, not 1: a country lane is not a town street. Roads are meant to be a
     thread the player can follow to find somewhere, not a feature to look at,
     so out here they are narrow enough to read as a route and no wider. */
  const base=runs?Math.max(urb,0.62):urb;
  return base*sand;
}
/* Boolean form, for the dozens of "is there tarmac here" tests. */
export function roadHere(x,z){ return roadWidth(x,z)>0.12; }

export const ROAD_S    = 300;   // spacing between parallel corridors (wider = fewer roads)
/* The corridor grid is offset by half a spacing, so NO corridor line runs
   through the world origin. Every run starts there — in the middle of the
   desert beside the Area 51 sign — and the middle of the desert cannot have a
   highway down the centre of it. With the phase the nearest nominal line is
   ROAD_S/2 away, and the router's restricted-area cost below bends it further
   out still. Everything that enumerates corridors goes through kIndex/kAt so
   the phase is stated once. */
export const ROAD_K0   = ROAD_S/2;
export const kIndex = v => Math.round((v-ROAD_K0)/ROAD_S);
export const kAt    = n => n*ROAD_S+ROAD_K0;
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
const OP_SHARE = 0.16;   // fraction of 4-way crossings built as an overpass (kept low — most join flat)

function jhash(a,b){ let h=Math.imul(a|0,73856093)^Math.imul(b|0,19349663); h^=h>>>13; return ((h>>>0)%100000)/100000; }
/* mode for the junction at world grid coords (kx,kz) — both multiples of ROAD_S. */
export function junctionMode(kx,kz){
  const ix=kIndex(kx), iz=kIndex(kz);
  if(jhash(ix,iz)<OP_SHARE) return { overpass:true, over: jhash(iz*7+1,ix*13+3)<0.5 ? 'x' : 'z' };
  return { overpass:false };
}
/* Extra deck height for corridor (axis,k) at world coordinate t along its axis,
   from any nearby overpass where THIS corridor is the one on top. A raised-cosine
   hump so vehicles climb a smooth ramp up and over, then settle again. */
export function overpassLift(axis,k,t){
  let lift=0;
  const c0=kAt(kIndex(t));
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
export function clearRoadCache(){ cCell.clear();cBlock.clear();cOff.clear();cDeck.clear();cEdge.clear();cEnv.clear();cWater.clear();cH.clear(); }

/* Point on the corridor's nominal (unrouted) line. */
function base(axis,k,t){
  return axis==='x' ? {x:t, z:k+wob(t)} : {x:k+wob(t), z:t};
}
/* Apply a sideways offset d to a nominal point. */
function shift(axis,p,d){
  return axis==='x' ? {x:p.x, z:p.z+d} : {x:p.x+d, z:p.z};
}
const cand=n=>-MAXDEV+(2*MAXDEV)*n/(NCAND-1);

/* Ground height at candidate n of step i, memoized — the cross-slope term below
   reads its NEIGHBOURS' heights, and adjacent candidates are ~4 units apart
   perpendicular to the corridor, which is exactly the direction the carriageway
   is wide in. So the samples each cell needs are the samples its neighbours
   already took. */
const cH=new Map();
function candH(axis,k,i,n){
  const kk=key(axis,k,i)+':h'+n; let v=cH.get(kk);
  if(v!==undefined)return v;
  const p=shift(axis,base(axis,k,i*STEP),cand(n));
  v=heightAt(p.x,p.z); cH.set(kk,v); return v;
}

/* Terrain cost of putting the road at candidate n, step i. */
function cellCost(axis,k,i,n){
  const kk=key(axis,k,i)+':'+n; let v=cCell.get(kk);
  if(v!==undefined)return v;
  const t=i*STEP, d=cand(n);
  const p=shift(axis,base(axis,k,t),d);
  const h=candH(axis,k,i,n);
  let c=0;
  if(h>6)c+=Math.pow(h-6,1.55);        // climbing is expensive
  if(h>MTN_H)c+=5000;                  // never ride onto a mountain — thread the pass instead
  if(h<WATER_Y)c+=26+(WATER_Y-h)*1.1;  // crossing water is a last resort, not banned
  /* CROSS-SLOPE. A carriageway is level across its width, so it must clear the
     highest ground under it — and costing only the centre line let the router
     run along the foot of a mountain with the uphill edge buried 20m into the
     slope, which then came out as a deck on a 20m bank. Costing the rise ACROSS
     the corridor makes the DP step out onto the flat instead of benching itself
     into a hillside, which is what actually keeps roads on the surface in hill
     country — the deck cap alone cannot, because clearing that edge is the one
     thing it is not allowed to compromise on. */
  const hl=candH(axis,k,i,Math.max(0,n-1)), hr=candH(axis,k,i,Math.min(NCAND-1,n+1));
  const cross=Math.abs(hr-hl);
  c+=cross*cross*0.9;
  c+=d*d*0.004;                        // prefer to stay near the corridor
  /* The restricted area around the landing site. A flat ban would make the DP
     pick some arbitrary escape; a cost that grows as you approach makes it bow
     smoothly around the zone and rejoin its line afterwards, which is what a
     road diverted around a government facility actually looks like. */
  const dr=Math.hypot(p.x,p.z);
  if(dr<RESTRICT_R)c+=800+(RESTRICT_R-dr)*45;
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

const ENV_WIN   = 3;   // half-window (steps, ~18u) for the ground upper-envelope —
                       // smaller so the road hugs the ground more and rides on far
                       // less fill (a thinner, more natural profile), while...
const GRADE_WIN  = 7;  // ...this easing still keeps the grade smooth, not wavy

/* THE CEILING, and the reason it exists. The grade line above is an upper
   envelope: it takes the highest ground in a window and rules a level line at
   that height. Over gentle country that is exactly right. Over DUNES it is a
   disaster — a dune field is 17m of relief on a ~220m wavelength, so the
   envelope latches onto crest height and rules it straight across every trough,
   and the road comes out as a viaduct on pillars marching across flat sand.

   So the deck may never sit more than MAX_RISE above the ground it is actually
   crossing. On level land nothing changes and the grade line still rules; over
   dunes the deck is pulled down onto the sand and undulates gently with it. The
   cap tracks crossMax, which is smooth wherever the terrain is, so it does not
   put a kink in the profile. Bridges over water and overpass humps are applied
   AFTER the cap and are deliberately exempt — those are the ONLY two places a
   road is allowed to leave the ground.

   The cap is measured from crossMax — the highest ground across the deck's own
   width at THIS step — and not from envAt. envAt is a max over a +-18u window,
   so on a dune flank (slope up to 0.29) it already sits 5m above the ground the
   deck is actually over, and capping against it still let a quarter of every
   corridor fly more than 4m up. crossMax is the exact terrain the deck has to
   clear, so capping against it puts the road ON the sand and nothing pokes
   through; measured, it takes the median rise to ~1.0 and the p95 to ~1.2. */
const MAX_RISE  = 0.9;

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
  const cap=crossMax(axis,k,i)+ROAD_LIFT+MAX_RISE;
  if(y>cap)y=cap;
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
    const k0=kAt(Math.ceil((c-MAXDEV-ROAD_HW-ROAD_K0)/ROAD_S));
    for(let k=k0;k<=c+MAXDEV+ROAD_HW;k+=ROAD_S){
      // a corridor that does not run out here has no tarmac to be near
      if(roadWidth(x,z,axis,k)<=0.12)continue;
      const sp=roadSample(axis,k,t);
      const d=Math.hypot(sp.x-x,sp.z-z);
      if(d<bd){bd=d;by=sp.y;}
    }
  }
  return {d:bd,y:by};
}
export function roadHeightAt(x,z){
  const n=nearestRoad(x,z);
  return n.d<ROAD_HW+1.2 ? n.y : -Infinity;   // nearestRoad already skips corridors that do not run
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
  const kx0=kAt(Math.ceil((ox-ROAD_K0)/ROAD_S)), kz0=kAt(Math.ceil((oz-ROAD_K0)/ROAD_S));
  for(let kx=kx0;kx<ox+size;kx+=ROAD_S)for(let kz=kz0;kz<oz+size;kz+=ROAD_S){
    let best=Infinity,bx=0,bz=0,by=0,ang=0;
    for(let t=kx-90;t<=kx+90;t+=STEP){
      const a=roadSample('x',kz,t);        // X-road point
      const b=roadSample('z',kx,a.z);      // Z-road point at the same z
      const d=Math.abs(a.x-b.x);
      if(d<best){best=d;bx=(a.x+b.x)*0.5;bz=a.z;by=Math.max(a.y,b.y);ang=Math.atan2(a.fx,a.fz);}
    }
    // a junction needs BOTH arms to actually exist here
    if(best<ROAD_HW*1.7 && roadWidth(bx,bz,'x',kz)>0.5 && roadWidth(bx,bz,'z',kx)>0.5){
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
    const k0=Math.ceil((lo-ROAD_K0)/ROAD_S), k1=Math.floor((hi-ROAD_K0)/ROAD_S);
    for(let n=k0;n<=k1;n++)out.push({axis,k:kAt(n)});
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
  /* MAXFILL is how much height difference an EMBANKMENT will swallow before the
     span is treated as a bridge and put on pillars. It was 1.5, which over any
     rolling ground meant pillars almost immediately. A real road crossing a dip
     is built on fill, not on a viaduct — pillars are for water and overpasses —
     so this now comfortably exceeds MAX_RISE and the two together mean a pier
     appears only where the deck is genuinely flying. */
  const SLAB=0.4, MAXFILL=4.2;
  let along=0, vbase=0, wasOn=false;
  const grp=new THREE.Group();

  for(let i=i0;i<=i1;i++){
    const p=pathAt(axis,k,i);
    const pn=pathAt(axis,k,i+1);
    let fx=pn.x-p.x, fz=pn.z-p.z; const l=Math.hypot(fx,fz)||1; fx/=l;fz/=l;
    const nx=fz, nz=-fx;                       // left normal
    // Flat grade: both edges share one level, so the carriageway is level
    // across its width (no bank) and level along the flats, easing only over
    // long distances. Terrain is met by a fill skirt, gaps by piers.
    /* The carriageway TAPERS. roadWidth is a width, not a flag, so a lane
       leaving town narrows through the blend into a track and then into
       nothing — instead of a full-width road stopping square in open country,
       which is what this looked like before and was the whole complaint. */
    const w=roadWidth(p.x,p.z,axis,k);
    const HW=ROAD_HW*w;
    const lx=p.x+nx*HW, lz=p.z+nz*HW;
    const rx=p.x-nx*HW, rz=p.z-nz*HW;
    const y=deckEdge(axis,k,i);
    const ly=y, ry=y;
    // A shallow fill reaches the ground as a low embankment; once the deck sits
    // well clear of the ground it's a bridge/overpass, carried as a THIN deck
    // slab on piers rather than a tall solid wall (which read as a chunky slab).
    const lg=heightAt(lx,lz), rg=heightAt(rx,rz);
    const lfill=ly-lg, rfill=ry-rg;
    /* Is this a BRIDGE — a span over water, or the raised carriageway of an
       overpass? Those are the only two places a road is allowed to leave the
       ground, and the only two that get a thin slab on pillars. Everywhere
       else the skirt is carried all the way down to the terrain however deep
       the fill, so a crossing reads as an earth embankment. A road on a bank is
       what the country actually looks like; a road on stilts across open sand
       is not. */
    const bridging = overWater(axis,k,i) || overpassLift(axis,k,i*STEP)>0.6;
    const lb = (!bridging||lfill<=MAXFILL) ? lg-0.25 : ly-SLAB;
    const rb = (!bridging||rfill<=MAXFILL) ? rg-0.25 : ry-SLAB;
    pos.push(lx, ly, lz);
    pos.push(rx, ry, rz);
    pos.push(lx, lb, lz);
    pos.push(rx, rb, rz);
    uv.push(0,along, 1,along, 0,along, 1,along);
    /* Only the URBAN stretches are surfaced. The vertices are still emitted so
       the strip's indexing stays simple; what is skipped is the pair of
       triangles joining this rib to the last, so the ribbon simply stops at the
       edge of town instead of running on across the sand. */
    const on=w>0.12;
    if(i>i0 && on && wasOn){
      const a=vbase-4, b=vbase;
      // Winding matters: with the deck wound the other way its normal points
      // DOWN and the whole carriageway is backface-culled, leaving only the
      // skirts visible edge-on — a thin dark line instead of a road.
      idx.push(a,a+1,b,  b,a+1,b+1);           // deck (faces up)
      idx.push(a+2,b+2,a, a,b+2,b);            // outer skirt
      idx.push(a+1,a+3,b+1, a+3,b+3,b+1);      // inner skirt
    }
    vbase+=4;
    wasOn=on;
    along+=STEP/TILE_ALONG;

    // Pillars only under a real bridge span, and only where it is genuinely
    // flying — the deck cap above keeps everything else on the ground.
    if(i%4===0 && on && bridging && lfill>MAXFILL && rfill>MAXFILL){
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
