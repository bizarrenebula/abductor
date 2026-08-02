/* =========================================================================
   TERRAIN — combined height/biome/color sampler for Earth and the alien
   worlds. sample() branches on the active world (World.name).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { WATER_Y, MTN_H } from '../core/constants.js';
import { smoothstep, lerp } from '../core/math.js';
import { nElev, nHill, nMtn, nRiver, nTemp, nMoist, nDune, fbm } from './noise.js';
import { regionWeights } from './regions.js';
import { World } from './world-config.js';

const _c=new THREE.Color();

/* Desert dunes: long parallel ridges, warped by noise so they snake rather than
   ruling straight lines across the map. The ridge direction is fixed for the
   whole world — real dune fields align to a prevailing wind, and a coherent
   direction is what makes them read as dunes instead of lumps. */
const DUNE_DIR=0.55, DC=Math.cos(DUNE_DIR), DS=Math.sin(DUNE_DIR);

/* One dune's cross-section. A sine is the wrong shape: real dunes are
   ASYMMETRIC — the wind pushes sand up a long shallow windward face and it
   avalanches off a short steep slip face on the lee side. That silhouette is
   most of what makes sand read as sand rather than as green hills painted
   yellow, so the crest sits at 0.72 of the cycle instead of halfway. */
function duneWave(u){
  let s=u*0.15915494;                 // radians -> turns
  s-=Math.floor(s);
  return s<0.72 ? smoothstep(0,0.72,s) : 1-smoothstep(0.72,1,s);
}
function duneHeight(x,z){
  const along=x*DC+z*DS, across=-x*DS+z*DC;
  // main train, snaked by low-frequency noise so ridges wander instead of ruling
  // straight lines from horizon to horizon
  const u=along*0.030 + fbm(nDune,x*0.0016,z*0.0016,2)*5.0;
  // a second, weaker train at an angle: where the two crests coincide you get a
  // tall star dune, where they cancel you get an open pan. That interference is
  // what stops a dune field looking like corrugated iron.
  const v=across*0.017 + fbm(nDune,x*0.0021-40,z*0.0021+40,2)*4.0;
  return duneWave(u)*17 + duneWave(v)*5.5
       + fbm(nDune,x*0.012,z*0.012,2)*1.4          // grain of the surface
       + fbm(nDune,x*0.06,z*0.06,2)*0.35;          // wind ripples
}

export function sampleEarth(x,z){
  const W=regionWeights(x,z);
  const wWild=W.wild, wDes=W.des, wUrb=W.urb;

  // Shared rolling base — low frequency so land reads as broad hills, not lumps.
  const continent=fbm(nElev,x*0.0024,z*0.0024,4);
  const hills=fbm(nHill,x*0.012,z*0.012,3);

  /* Each region has its own height, and the final ground is their blend. This
     is what makes a border a slope rather than a cliff: no test decides which
     land you are on, all three are always evaluated and weighted. */
  const mtnMask=fbm(nMtn,x*0.0026+30,z*0.0026-30,4);
  let mtn=Math.max(0,mtnMask-0.02)*22;          // broad shoulders
  const mm=Math.max(0,mtnMask-0.14);
  mtn+=mm*mm*250;                               // steep summits
  const hWild=continent*15+hills*3.2+7+mtn;     // hills AND mountains
  const hDes =continent*5.5+9+duneHeight(x,z);  // no rock, all dune
  const hUrb =continent*7+hills*1.7+6;          // low hills only, distinctly flatter

  let h=hWild*wWild+hDes*wDes+hUrb*wUrb;

  /* Lakes in the two green regions. The desert stays dry — its weight scales
     the basin away, so a lake fades out as you approach the sand rather than
     ending at a line. */
  const lakeF=fbm(nRiver,x*0.0030,z*0.0030,3);
  /* No water may TOUCH the desert. Scaling by (1-wDes) was not enough: it only
     shrinks the basin, so a lake could still sit at wDes 0.3 with sand at 0.6 a
     few metres away — a shoreline against dunes. Cutting the basin out entirely
     by wDes 0.30, while the sand itself only starts being called desert at 0.50,
     leaves a band of dry non-desert ground between any water and the first
     grain of sand. */
  const lakeAmt=smoothstep(-0.10,-0.34,lakeF)*(1-smoothstep(14,34,h))
               *(1-smoothstep(0.0,0.30,wDes));
  if(lakeAmt>0)h=lerp(h,Math.min(h,WATER_Y-5),lakeAmt);

  /* ---- biome: still the old vocabulary, so every existing consumer keeps
     working, but now decided by REGION rather than by temperature noise. ---- */
  let biome;
  if(h<WATER_Y+0.15) biome='water';
  else if(wDes>0.5) biome='desert';
  else if(wWild>0.5&&(h>30||mtnMask>0.5)) biome='mountain';
  else{
    // Forest belongs to the wilderness. Urban land gets scattered trees, not
    // woods, so it stays 'plains' and the chunk spawner thins it there.
    const moist=nMoist(x*0.004-200,z*0.004-200);
    biome=(wWild>0.5&&moist>0.05)?'forest':'plains';
  }

  // colour
  let r,g,b;
  const tint=fbm(nHill,x*0.05+9,z*0.05-9,2)*0.04;
  if(biome==='water'){ r=0.01;g=0.09;b=0.17; }                 // deep blue lakebed
  else if(h<WATER_Y+1.4&&wDes<0.5){ r=0.56;g=0.46;b=0.26; }    // warm wet sand shore
  else if(biome==='desert'){
    // dune crests catch the light, troughs stay in shade
    const lift=Math.max(0,Math.min(1,(h-8)/18));
    r=0.62+tint+lift*0.16; g=0.45+tint*0.6+lift*0.13; b=0.17+lift*0.05;
  }
  else if(biome==='mountain'){
    if(h>40){ r=0.88;g=0.93;b=1.00; }                          // bright snow cap
    else{ const rock=0.22+tint; r=rock;g=rock+0.02;b=rock+0.09; }    // cool slate
  }
  else if(biome==='forest'){ r=0.03+tint;g=0.32+tint*1.3;b=0.09+tint; }
  else {
    // Urban grass is a touch duller and yellower than wilderness meadow — mown
    // and lived on rather than wild.
    r=(0.07+tint)+wUrb*0.06; g=(0.50+tint*1.6)-wUrb*0.07; b=(0.12+tint)-wUrb*0.02;
  }
  return {h,biome,r,g,b,region:wDes>wUrb?(wDes>wWild?1:0):(wUrb>wWild?2:0),
          wWild,wDes,wUrb};
}

export function sampleAlien(x,z){
  let h=fbm(nElev,x*0.008,z*0.008,3)*10+fbm(nHill,x*0.03,z*0.03,2)*2;
  const c=fbm(nMtn,x*0.012+50,z*0.012-50,2);
  h+=smoothstep(0.16,0.28,c)*4;         // crater rims
  h-=smoothstep(0.24,0.52,c)*10;        // crater bowls
  const tint=fbm(nHill,x*0.05+9,z*0.05-9,2)*0.05;
  let r,g,b,biomeId;
  if(World.name==='mars'){
    h+=Math.max(0,fbm(nRiver,x*0.004,z*0.004,3)-0.25)*46;  // mesas
    r=0.48+tint*1.6;g=0.19+tint*0.6;b=0.11+tint*0.3;biomeId=1;
  }else{
    const l=0.30+tint-smoothstep(0.24,0.52,c)*0.12;        // darker crater floors
    r=l;g=l+0.01;b=l+0.03;biomeId=2;
  }
  return {h,biome:World.name,r,g,b,biomeId};
}
export function sample(x,z){return World.name==='earth'?sampleEarth(x,z):sampleAlien(x,z);}
export const heightAt=(x,z)=>sample(x,z).h;

/* Steepness at a point: the biggest height change over `d` units, as rise/run.
   ~0 on a meadow, >0.6 on a cliff face or a canyon lip. */
export function slopeAt(x,z,d=3){
  const h=heightAt(x,z);
  let m=0;
  for(const o of [[d,0],[-d,0],[0,d],[0,-d]])
    m=Math.max(m,Math.abs(heightAt(x+o[0],z+o[1])-h));
  return m/d;
}

/* Can a ground-standing creature or collectible live here?

   Keeps things off the places where they look broken or unreachable: in open
   water (unless it is meant to be there, like a shore duck), balanced on a cliff
   edge where half the model hangs over a drop, and on mountain tops. One shared
   test so animals, crystals and ship modules all agree on what "good ground" is.

   opts.water  — true for water dwellers: shallows are fine, open water is not
   opts.slope  — max steepness (default 0.5; a gentle hillside still passes)
   opts.maxH   — height ceiling (defaults to just below the mountain line) */
export function goodGround(x,z,opts){
  const o=opts||{};
  const sm=sample(x,z);
  if(sm.biome==='water'){
    if(!o.water)return false;
    if(sm.h<WATER_Y-1.5)return false;          // shore only, never mid-lake
  }else if(o.water===true&&o.waterOnly)return false;
  if(sm.h>(o.maxH!=null?o.maxH:MTN_H-4))return false;   // not on the peaks
  if(sm.biome==='mountain'&&!o.mountain)return false;
  if(slopeAt(x,z)>(o.slope!=null?o.slope:0.5))return false;   // no cliff edges
  return true;
}
