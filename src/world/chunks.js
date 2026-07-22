/* =========================================================================
   CHUNK MANAGER — the infinite streamed world. Each chunk is a colored,
   texture-splatted terrain tile that also spawns creatures, crystals, props,
   buildings, and humans; chunks load/unload around the ship.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { CHUNK, SEG, WATER_Y, GROUND_TILING } from '../core/constants.js';
import { scene } from '../core/engine.js';
import { World } from './world-config.js';
import { sample } from './terrain.js';
import { TEX, grassTex, sandTex, rockTex, snowTex } from './textures.js';
import { animals, pickups, props, buildings, shelters } from '../entities/registry.js';
import { buildAnimal } from '../entities/animals.js';
import { buildAlien } from '../entities/aliens.js';
import { buildCrystal } from '../entities/crystals.js';
import { buildProp } from '../entities/props.js';
import { buildBuilding, buildHuman } from '../entities/humans.js';

const LOW_END = env.LOW_END;

export const chunks=new Map();
export function chunkKey(cx,cz){return cx+'|'+cz;}

const groundMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0.02});
groundMat.onBeforeCompile=sh=>{
  sh.uniforms.tGrass={value:TEX.grass||grassTex};sh.uniforms.tSand={value:TEX.sand||sandTex};sh.uniforms.tRock={value:TEX.mountain||rockTex};sh.uniforms.tSnow={value:snowTex};
  // vDuv stays the raw 0..1 chunk UV; each texture applies its own tiling at
  // sample time so they can be scaled independently (see GROUND_TILING).
  const T=n=>GROUND_TILING[n].toFixed(1);
  sh.vertexShader='attribute float aBiome;varying float vBiome;varying vec2 vDuv;\n'+sh.vertexShader
    .replace('#include <uv_vertex>','#include <uv_vertex>\nvBiome=aBiome;vDuv=uv;');
  sh.fragmentShader='uniform sampler2D tGrass;uniform sampler2D tSand;uniform sampler2D tRock;uniform sampler2D tSnow;varying float vBiome;varying vec2 vDuv;\n'+sh.fragmentShader
    .replace('#include <color_fragment>','#include <color_fragment>\n{\nvec3 tg=texture2D(tGrass,vDuv*'+T('grass')+').rgb;vec3 ts=texture2D(tSand,vDuv*'+T('sand')+').rgb;vec3 tr=texture2D(tRock,vDuv*'+T('rock')+').rgb;vec3 tn=texture2D(tSnow,vDuv*'+T('snow')+').rgb;\nfloat w1=clamp(1.0-abs(vBiome-1.0),0.0,1.0);float w2=clamp(1.0-abs(vBiome-2.0),0.0,1.0);float w3=clamp(vBiome-2.0,0.0,1.0);float w0=clamp(1.0-vBiome,0.0,1.0);\nvec3 tc=(tg*w0+ts*w1+tr*w2+tn*w3)/max(w0+w1+w2+w3,0.001);\ndiffuseColor.rgb*=mix(vec3(1.0),tc*2.05,0.9);\n}');
};

export function buildChunk(cx,cz){
  const geo=new THREE.PlaneGeometry(CHUNK,CHUNK,SEG,SEG);
  geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position;
  const colors=new Float32Array(pos.count*3);
  const bios=new Float32Array(pos.count);
  const ox=cx*CHUNK, oz=cz*CHUNK;
  for(let i=0;i<pos.count;i++){
    const wx=ox+pos.getX(i), wz=oz+pos.getZ(i);
    const sm=sample(wx,wz);
    pos.setY(i,sm.h);
    colors[i*3]=sm.r;colors[i*3+1]=sm.g;colors[i*3+2]=sm.b;
    bios[i]=sm.biomeId!=null?sm.biomeId
      :(sm.biome==='mountain')?(sm.h>36?3:2)
      :(sm.biome==='plains'&&sm.h>=WATER_Y+1.4)?0:1;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geo.setAttribute('aBiome',new THREE.BufferAttribute(bios,1));
  geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,groundMat);
  mesh.position.set(ox,0,oz);mesh.receiveShadow=true;
  scene.add(mesh);
  // spawn animals / pickups / props
  const spawned=[],pk=[],pr=[];
  const tries=LOW_END?4:7;
  for(let t=0;t<tries;t++){
    const wx=ox+Math.random()*CHUNK, wz=oz+Math.random()*CHUNK;
    const sm=sample(wx,wz);
    let a;
    if(World.name==='earth'){
      const chance=(sm.biome==='water')?0.72:0.5;
      if(Math.random()>chance) continue;
      a=buildAnimal(sm.biome);
      a.position.set(wx,(sm.biome==='water'?WATER_Y+0.15:sm.h),wz);
    }else{
      if(Math.random()>0.5) continue;
      const roll=Math.random();
      const form=World.name==='moon'
        ?(roll<0.45?'blob':roll<0.8?'crawler':'skimmer')
        :(roll<0.4?'strider':roll<0.7?'wormling':'tumbler');
      a=buildAlien(form);
      a.position.set(wx,sm.h+(a.userData.hover||0),wz);
    }
    a.rotation.y=a.userData.face;
    scene.add(a);animals.push(a);spawned.push(a);
  }
  if(Math.random()<0.38){
    const ccx2=ox+Math.random()*CHUNK, ccz2=oz+Math.random()*CHUNK;
    const nCr=2+((Math.random()*3)|0);
    for(let k=0;k<nCr;k++){
      const wx=ccx2+(Math.random()-0.5)*10, wz=ccz2+(Math.random()-0.5)*10;
      const sm=sample(wx,wz);
      if(World.name==='earth'&&sm.biome==='water')continue;
      const item=buildCrystal();
      const by=sm.h-0.45;                    // semi-buried
      item.position.set(wx,by,wz);item.userData.baseY=by;
      item.rotation.y=Math.random()*6.28;
      scene.add(item);pickups.push(item);pk.push(item);
    }
  }
  for(let t=0;t<(LOW_END?2:3);t++){
    if(Math.random()>0.55)continue;
    const wx=ox+Math.random()*CHUNK, wz=oz+Math.random()*CHUNK;
    const sm=sample(wx,wz);
    if(World.name==='earth'&&sm.biome==='water')continue;
    const prop=buildProp(sm.biome);
    prop.position.set(wx,sm.h,wz);prop.userData.baseY=sm.h;
    prop.rotation.y=Math.random()*6.28;
    scene.add(prop);props.push(prop);pr.push(prop);
  }
  const bl=[],sh=[];
  if(World.name==='earth'&&Math.random()<0.32){
    const wx=ox+8+Math.random()*(CHUNK-16), wz=oz+8+Math.random()*(CHUNK-16);
    const sm=sample(wx,wz);
    if(sm.biome!=='water'&&sm.h<20){
      const kind=sm.biome==='plains'?'barn':'camp';
      const b=buildBuilding(kind);
      b.position.set(wx,sm.h,wz);b.rotation.y=Math.random()*6.28;
      scene.add(b);bl.push(b);buildings.push(b);
      const shel={x:wx,z:wz};shelters.push(shel);sh.push(shel);
      const nh=1+((Math.random()*2)|0);
      for(let h=0;h<nh;h++){
        const hx=wx+(Math.random()-0.5)*16, hz=wz+(Math.random()-0.5)*16;
        const sm2=sample(hx,hz);
        if(sm2.biome==='water')continue;
        const hu=buildHuman(kind==='barn'?'villager':'hiker');
        hu.position.set(hx,sm2.h,hz);hu.rotation.y=hu.userData.face;
        scene.add(hu);animals.push(hu);spawned.push(hu);
      }
    }
  }else if(World.name==='earth'&&Math.random()<0.1){
    const wx=ox+Math.random()*CHUNK, wz=oz+Math.random()*CHUNK;
    const sm=sample(wx,wz);
    if(sm.biome==='mountain'||sm.biome==='plains'){
      const hu=buildHuman('hiker');
      hu.position.set(wx,sm.h,wz);
      scene.add(hu);animals.push(hu);spawned.push(hu);
    }
  }
  chunks.set(chunkKey(cx,cz),{mesh,animals:spawned,pickups:pk,props:pr,builds:bl,shel:sh});
}

export function updateChunks(px,pz){
  const ccx=Math.round(px/CHUNK), ccz=Math.round(pz/CHUNK);
  const VIEW_R=env.VIEW_R;
  // add
  for(let dz=-VIEW_R;dz<=VIEW_R;dz++)for(let dx=-VIEW_R;dx<=VIEW_R;dx++){
    const k=chunkKey(ccx+dx,ccz+dz);
    if(!chunks.has(k)) buildChunk(ccx+dx,ccz+dz);
  }
  // remove far
  for(const [k,c] of chunks){
    const [kx,kz]=k.split('|').map(Number);
    if(Math.abs(kx-ccx)>VIEW_R+0.5||Math.abs(kz-ccz)>VIEW_R+0.5){
      scene.remove(c.mesh);c.mesh.geometry.dispose();
      c.animals.forEach(a=>{scene.remove(a);const idx=animals.indexOf(a);if(idx>=0)animals.splice(idx,1);});
      c.pickups.forEach(o=>{scene.remove(o);const idx=pickups.indexOf(o);if(idx>=0)pickups.splice(idx,1);});
      c.props.forEach(o=>{scene.remove(o);const idx=props.indexOf(o);if(idx>=0)props.splice(idx,1);});
      c.builds.forEach(o=>{scene.remove(o);const idx=buildings.indexOf(o);if(idx>=0)buildings.splice(idx,1);});
      c.shel.forEach(s=>{const idx=shelters.indexOf(s);if(idx>=0)shelters.splice(idx,1);});
      chunks.delete(k);
    }
  }
}
export function clearWorld(){
  for(const [k,c] of chunks){scene.remove(c.mesh);c.mesh.geometry.dispose();
    c.animals.forEach(a=>scene.remove(a));
    c.pickups.forEach(o=>scene.remove(o));
    c.props.forEach(o=>scene.remove(o));
    c.builds.forEach(o=>scene.remove(o));}
  chunks.clear();animals.length=0;pickups.length=0;props.length=0;buildings.length=0;shelters.length=0;
}
