/* =========================================================================
   TERRAIN — combined height/biome/color sampler for Earth and the alien
   worlds. sample() branches on the active world (World.name).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { WATER_Y, MTN_H } from '../core/constants.js';
import { smoothstep, lerp } from '../core/math.js';
import { nElev, nHill, nMtn, nRiver, nTemp, nMoist, fbm } from './noise.js';
import { World } from './world-config.js';

const _c=new THREE.Color();
export function sampleEarth(x,z){
  // Smooth, broad rolling base — lower frequencies so the land reads as gentle
  // hills and valleys, not busy lumps. Biased upward so most of the map is dry
  // land, with water reserved for real basins.
  const continent=fbm(nElev,x*0.0024,z*0.0024,4);
  const hills=fbm(nHill,x*0.012,z*0.012,3);
  let h=continent*15+hills*3.2+7;

  // Tall mountain ranges. A LOW-frequency mask makes the massifs broad and
  // sprawling (each range covers a lot of land), a gentle skirt widens the base
  // into the surrounding hills, and a steeper term raises the summits.
  const mtnMask=fbm(nMtn,x*0.0026+30,z*0.0026-30,4);
  h+=Math.max(0,mtnMask-0.02)*22;      // broad shoulders — the wide footprint
  const mm=Math.max(0,mtnMask-0.14);
  h+=mm*mm*250;                        // steep summits on top

  // Broad LAKES in the lowlands — the only water/dips on the map. A gentle basin
  // that floods where already-low land dips, so water reads as proper lakes with
  // soft shorelines. No dry canyons/gorges: the land is hills, meadows, lakes and
  // mountains, never sharp chasms.
  const lakeF=fbm(nRiver,x*0.0030,z*0.0030,3);
  const lakeAmt=smoothstep(-0.10,-0.34,lakeF)*(1-smoothstep(14,34,h));
  if(lakeAmt>0)h=lerp(h,Math.min(h,WATER_Y-5),lakeAmt);        // gentle lake bed

  // biome
  let biome;
  if(h<WATER_Y+0.15) biome='water';
  else if(h>30||mtnMask>0.5) biome='mountain';
  else{
    const temp=nTemp(x*0.004+200,z*0.004+200);
    const moist=nMoist(x*0.004-200,z*0.004-200);
    if(temp>0.16&&moist<0.0) biome='desert';
    else if(moist>0.12) biome='forest';                        // wet, tree-dense
    else biome='plains';
  }
  // color
  let r,g,b;
  const tint=fbm(nHill,x*0.05+9,z*0.05-9,2)*0.04;
  // Vivid, saturated palette: each biome should be recognisable at a glance, so
  // the channels are pushed APART (low red/blue on grass, warm gold on sand)
  // rather than simply brightened, which would wash the night look out.
  if(biome==='water'){ r=0.01;g=0.09;b=0.17; }                 // deep blue lakebed
  else if(h<WATER_Y+1.4){ r=0.56;g=0.46;b=0.26; }              // warm wet sand shore
  else if(biome==='desert'){ r=0.72+tint;g=0.52+tint*0.6;b=0.20; }   // golden sand
  else if(biome==='mountain'){
    if(h>40){ r=0.88;g=0.93;b=1.00; }                          // bright snow cap
    else{ const rock=0.22+tint; r=rock;g=rock+0.02;b=rock+0.09; }    // cool slate
  } else if(biome==='forest'){ r=0.03+tint;g=0.32+tint*1.3;b=0.09+tint; }       // deep rich green
  else { r=0.07+tint;g=0.50+tint*1.6;b=0.12+tint; }            // vivid plains grass
  return {h,biome,r,g,b};
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
