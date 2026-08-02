/* =========================================================================
   MONUMENTS — the pyramids, and the sphinx beside one of them.

   Same deterministic hash-grid pattern as settlements and farmland: a coarse
   cell grid, one hashed candidate per cell, and a pure function of position
   deciding whether anything stands there. That is what lets chunks stream in
   any order and still agree, and what lets the minimap and the collision test
   ask "is there a monument here" without a global list.

   The cell is deliberately huge — 2200 units — because the whole point of a
   monument is that it is ALONE. Two pyramids a chunk apart would be scenery.
   Measured over four seeds, a 121-cell sweep yields 15-17 pyramids, 1-4 of them
   with a sphinx, and the nearest to the landing site is 1-3km out: far enough
   that finding one is an event, near enough that you will.
   ========================================================================= */
import { sample, slopeAt, heightAt } from './terrain.js';
import { roadDist } from './roads.js';
import { regionAt, DESERT } from './regions.js';
import { worldSeed } from './noise.js';
import { RESTRICT_R } from '../core/constants.js';
import { PYRAMID_R } from '../entities/egypt.js';

const CELL = 2200;
const OCCUPY = 0.55;
const CANDIDATES = 12;
/* One pyramid in six also has a sphinx. Rare enough that meeting the pair is a
   find rather than a fixture, common enough that a player who explores the
   desert will meet one. */
const SPHINX_SHARE = 0.17;
/* How far out in front of the pyramid the sphinx sits — far enough clear of the
   base that it is its own silhouette rather than a lump against the stone. */
const SPHINX_OUT = PYRAMID_R+34;

function hash(cx,cz,k){
  let h=Math.imul(cx|0,374761393)^Math.imul(cz|0,668265263)^Math.imul(k|0,2246822519)^worldSeed;
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967296;
}

/* Ground a pyramid can stand on: deep desert, dry, level enough that a 92-unit
   base does not hang off a dune face, clear of the road and of the restricted
   area around the landing site. Sampled over the whole footprint, not at the
   centre — the thing is wider than most of this world's terrain features. */
function siteOK(x,z){
  if(x*x+z*z<(RESTRICT_R+PYRAMID_R)*(RESTRICT_R+PYRAMID_R))return false;
  let lo=1e9, hi=-1e9;
  for(const ring of [[0,1],[PYRAMID_R*0.55,6],[PYRAMID_R,10]]){
    const rad=ring[0], n=ring[1];
    for(let i=0;i<n;i++){
      const a=n===1?0:i/n*Math.PI*2;
      const px=x+Math.cos(a)*rad, pz=z+Math.sin(a)*rad;
      if(regionAt(px,pz)!==DESERT)return false;
      const sm=sample(px,pz);
      if(sm.biome!=='desert')return false;
      if(sm.h<lo)lo=sm.h; if(sm.h>hi)hi=sm.h;
      if(slopeAt(px,pz,6)>0.34)return false;
    }
  }
  /* The tolerance is generous on purpose. A dune field is 17m of relief on a
     220m wavelength and the base is 92m across, so demanding a truly level pad
     found ONE site in a 13x13 cell sweep — the first pyramid was 11km from the
     spawn. Real builders levelled their plateau; this one is seated at the
     LOWEST ground under its footprint with the sand skirt covering the rest,
     which is the same trick and costs nothing. */
  if(hi-lo>15)return false;
  if(roadDist(x,z)<PYRAMID_R+30)return false;
  return true;
}

/* The lowest ground under the footprint — where the base is seated, so no
   corner of a 92-unit slab is left hanging in the air. */
function seatY(x,z){
  let lo=heightAt(x,z);
  for(const rad of [PYRAMID_R*0.55,PYRAMID_R])
    for(let i=0;i<10;i++){
      const a=i/10*Math.PI*2;
      const h=heightAt(x+Math.cos(a)*rad, z+Math.sin(a)*rad);
      if(h<lo)lo=h;
    }
  return lo;
}

const _cache=new Map();
/* The monument occupying a cell, or null. Pure function of the cell. */
export function monumentAt(cx,cz){
  const key=cx+'|'+cz;
  if(_cache.has(key))return _cache.get(key);
  let m=null;
  if(hash(cx,cz,0)<OCCUPY){
    for(let i=0;i<CANDIDATES;i++){
      const pad=PYRAMID_R+80;
      const x=cx*CELL+pad+hash(cx,cz,20+i)*(CELL-2*pad);
      const z=cz*CELL+pad+hash(cx,cz,60+i)*(CELL-2*pad);
      if(!siteOK(x,z))continue;
      let ang=hash(cx,cz,7)*Math.PI*2;
      /* The sphinx stands clear of the pyramid, which means it can land on a
         road even though the pyramid's own clearance passed — the first build
         put one straddling a carriageway. Rotate the pair until its spot is
         clean; if no bearing works, this pyramid simply stands alone. */
      let sphinx=hash(cx,cz,9)<SPHINX_SHARE;
      if(sphinx){
        let ok=false;
        for(let k=0;k<8;k++){
          const a=ang+k*Math.PI/4;
          const sx=x+Math.sin(a)*SPHINX_OUT, sz=z+Math.cos(a)*SPHINX_OUT;
          if(roadDist(sx,sz)<20)continue;
          if(sample(sx,sz).biome!=='desert')continue;
          if(slopeAt(sx,sz,6)>0.30)continue;
          ang=a; ok=true; break;
        }
        sphinx=ok;
      }
      m={x,z,y:seatY(x,z),ang,sphinx};
      break;
    }
  }
  _cache.set(key,m);
  return m;
}
export function clearMonumentCache(){ _cache.clear(); }

/* Every monument whose footprint could reach a box. CELL_PAD widens the scan by
   a cell because a monument sits anywhere inside its cell, not at its corner. */
export function monumentsNear(ox,oz,size){
  const out=[];
  const c0x=Math.floor((ox-CELL)/CELL), c1x=Math.floor((ox+size+CELL)/CELL);
  const c0z=Math.floor((oz-CELL)/CELL), c1z=Math.floor((oz+size+CELL)/CELL);
  for(let cx=c0x;cx<=c1x;cx++)for(let cz=c0z;cz<=c1z;cz++){
    const m=monumentAt(cx,cz);
    if(m)out.push(m);
  }
  return out;
}

/* Is (x,z) inside a monument's claimed ground? Used by the chunk spawner to
   keep cacti and wildlife from growing through the masonry. */
export function inMonument(x,z,r=0){
  for(const m of monumentsNear(x-1,z-1,2)){
    const dx=x-m.x, dz=z-m.z;
    const R=PYRAMID_R*1.18+r;
    if(dx*dx+dz*dz<R*R)return true;
    if(m.sphinx){
      const sx=x-(m.x+Math.sin(m.ang)*SPHINX_OUT);
      const sz=z-(m.z+Math.cos(m.ang)*SPHINX_OUT);
      if(sx*sx+sz*sz<(24+r)*(24+r))return true;
    }
  }
  return false;
}

/* Where the sphinx stands for a given monument: out in front of one face. */
export function sphinxPos(m){
  return { x:m.x+Math.sin(m.ang)*SPHINX_OUT,
           z:m.z+Math.cos(m.ang)*SPHINX_OUT };
}
