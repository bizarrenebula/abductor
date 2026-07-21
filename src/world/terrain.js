/* =========================================================================
   TERRAIN — combined height/biome/color sampler for Earth and the alien
   worlds. sample() branches on the active world (World.name).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { WATER_Y } from '../core/constants.js';
import { smoothstep, lerp } from '../core/math.js';
import { nElev, nHill, nMtn, nRiver, nTemp, nMoist, fbm } from './noise.js';
import { World } from './world-config.js';

const _c=new THREE.Color();
export function sampleEarth(x,z){
  const continent=fbm(nElev,x*0.0035,z*0.0035,4);
  const hills=fbm(nHill,x*0.02,z*0.02,3);
  let h=continent*14+hills*3.5;
  const mtnMask=fbm(nMtn,x*0.006+30,z*0.006-30,3);
  const m=Math.max(0,mtnMask-0.18); h+=m*m*90;
  // rivers carve channels
  const riv=nRiver(x*0.0065,z*0.0065);
  const channel=1-smoothstep(0,0.05,Math.abs(riv));
  if(channel>0 && h<24){ h=lerp(h, Math.min(h,WATER_Y-2.4), channel); }
  // biome
  let biome;
  if(h<WATER_Y+0.15) biome='water';
  else if(h>23||mtnMask>0.42) biome='mountain';
  else{
    const temp=nTemp(x*0.0045+200,z*0.0045+200);
    const moist=nMoist(x*0.0045-200,z*0.0045-200);
    biome=(temp>0.1&&moist<0.05)?'desert':'plains';
  }
  // color
  let r,g,b;
  const tint=fbm(nHill,x*0.05+9,z*0.05-9,2)*0.04;
  if(biome==='water'){ r=0.02;g=0.05;b=0.08; }
  else if(h<WATER_Y+1.4){ r=0.26;g=0.23;b=0.17; } // muddy shore
  else if(biome==='desert'){ r=0.50+tint;g=0.40+tint*0.6;b=0.24; }
  else if(biome==='mountain'){
    if(h>36){ r=0.74;g=0.80;b=0.90; }              // dim snow cap
    else{ const rock=0.19+tint; r=rock;g=rock+0.01;b=rock+0.04; }
  } else { // plains
    r=0.10+tint;g=0.31+tint*1.6;b=0.11+tint;
  }
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
