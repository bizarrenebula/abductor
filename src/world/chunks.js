/* =========================================================================
   CHUNK MANAGER — the infinite streamed world. Each chunk is a colored,
   texture-splatted terrain tile that also spawns creatures, crystals, props,
   buildings, and humans; chunks load/unload around the ship.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { CHUNK, SEG, WATER_Y, MTN_H, GROUND_TILING, VEH_PER_CHUNK, STATION_CHANCE, PROP_ROAD_GAP } from '../core/constants.js';
import { scene } from '../core/engine.js';
import { World } from './world-config.js';
import { sample } from './terrain.js';
import { TEX, grassTex, sandTex, rockTex, snowTex } from './textures.js';
import { ROAD_HW, STEP, roadsNear, roadSample, buildRoadMesh, clearRoadCache, roadTex, roadDist } from './roads.js';
import { animals, pickups, props, buildings, vehicles, shelters } from '../entities/registry.js';
import { buildAnimal } from '../entities/animals.js';
import { buildAlien } from '../entities/aliens.js';
import { buildCrystal } from '../entities/crystals.js';
import { buildProp } from '../entities/props.js';
import { buildBuilding, buildHuman } from '../entities/humans.js';
import { buildStation } from '../entities/stations.js';
import { buildVehicle, placeVehicle } from '../entities/vehicles.js';

const LOW_END = env.LOW_END;

export const chunks=new Map();
export function chunkKey(cx,cz){return cx+'|'+cz;}

const groundMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0.02});
groundMat.onBeforeCompile=sh=>{
  sh.uniforms.tGrass={value:TEX.grass||grassTex};sh.uniforms.tSand={value:TEX.sand||sandTex};sh.uniforms.tRock={value:TEX.mountain||rockTex};sh.uniforms.tSnow={value:snowTex};
  // vDuv stays the raw 0..1 chunk UV; each texture applies its own tiling at
  // sample time so they can be scaled independently (see GROUND_TILING).
  const T=n=>GROUND_TILING[n].toFixed(1);
  groundMat.userData.sh=sh;
  sh.vertexShader='attribute float aBiome;varying float vBiome;varying vec2 vDuv;\n'+sh.vertexShader
    .replace('#include <uv_vertex>','#include <uv_vertex>\nvBiome=aBiome;vDuv=uv;');
  sh.fragmentShader='uniform sampler2D tGrass;uniform sampler2D tSand;uniform sampler2D tRock;uniform sampler2D tSnow;varying float vBiome;varying vec2 vDuv;\n'+sh.fragmentShader
    .replace('#include <color_fragment>','#include <color_fragment>\n{\n'
      +'vec3 tg=texture2D(tGrass,vDuv*'+T('grass')+').rgb;vec3 ts=texture2D(tSand,vDuv*'+T('sand')+').rgb;vec3 tr=texture2D(tRock,vDuv*'+T('rock')+').rgb;vec3 tn=texture2D(tSnow,vDuv*'+T('snow')+').rgb;\n'
      +'float w1=clamp(1.0-abs(vBiome-1.0),0.0,1.0);float w2=clamp(1.0-abs(vBiome-2.0),0.0,1.0);float w3=clamp(vBiome-2.0,0.0,1.0);float w0=clamp(1.0-vBiome,0.0,1.0);\n'
      +'vec3 tc=(tg*w0+ts*w1+tr*w2+tn*w3)/max(w0+w1+w2+w3,0.001);\n'
      +'diffuseColor.rgb*=mix(vec3(1.0),tc*2.05,0.9);\n}');
};

/* Road surface. A separate raised mesh, so it never blends with the ground.
   The terrain shader multiplies its texture by ~2.05; without a matching lift
   the deck reads as a black slash across a bright landscape, so the material
   colour is used as a >1 multiplier on the map. */
const roadMat=new THREE.MeshStandardMaterial({map:roadTex,roughness:0.93,metalness:0.02,side:THREE.DoubleSide});
roadMat.color.setScalar(1.85);
const pierMat=new THREE.MeshStandardMaterial({color:0x53565c,roughness:0.95});
pierMat.color.multiplyScalar(1.5);

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
      :(sm.biome==='mountain')?(sm.h>40?3:2)      // snow cap / rock
      :(sm.biome==='canyon')?2                     // rock
      :((sm.biome==='plains'||sm.biome==='forest')&&sm.h>=WATER_Y+1.4)?0:1;  // grass / sand
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
      const w=sm.biome;
      let species;
      if(w==='water'){
        if(sm.h<WATER_Y-1.5)continue;                        // shore ducks only, no open water
        species='Duck';
      }else if(w==='desert'||w==='mountain'||w==='canyon'||sm.h>MTN_H-4){
        // No grazers on sand / mountains / canyons — only the odd bird passing over.
        if(Math.random()>0.20)continue;
        species='Bird';
      }else{
        // plains / forest: grazers kept off the road, plus a few birds.
        if(roadDist(wx,wz)<ROAD_HW+3)continue;
        if(Math.random()>0.55)continue;
        const r=Math.random();
        species=r<0.12?'Bird':r<0.64?'Sheep':'Goat';
      }
      a=buildAnimal(species);
      a.position.set(wx, a.userData.fly?Math.max(sm.h,WATER_Y)+a.userData.hover
                        :(w==='water'?WATER_Y+0.15:sm.h), wz);
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
  // Scenery: forests are tree-dense, plains sparse, deserts get the odd cactus.
  // More attempts per chunk, with the take-rate driven by biome so a forest
  // reads as a proper grove rather than scattered trees.
  const propTries=LOW_END?6:12;
  for(let t=0;t<propTries;t++){
    const wx=ox+Math.random()*CHUNK, wz=oz+Math.random()*CHUNK;
    const sm=sample(wx,wz);
    if(World.name==='earth'){
      if(sm.biome==='water')continue;
      // The shore band is still land but renders as wet sand — keep scenery above it.
      if(sm.h<WATER_Y+1.6)continue;
      // density per biome
      const dens=sm.biome==='forest'?0.92:sm.biome==='desert'?0.42:sm.biome==='canyon'?0.20
                :sm.biome==='mountain'?0.10:0.26;   // plains
      if(Math.random()>dens)continue;
      // Nothing on the tarmac or its verges.
      if(roadDist(wx,wz)<ROAD_HW+PROP_ROAD_GAP)continue;
    }else{
      if(Math.random()>0.45)continue;
    }
    const prop=buildProp(sm.biome);
    prop.position.set(wx,sm.h,wz);prop.userData.baseY=sm.h;
    prop.rotation.y=Math.random()*6.28;
    scene.add(prop);props.push(prop);pr.push(prop);
  }
  /* Buildings are placed after scenery, so anything they land on is removed —
     otherwise a gas station or barn swallows a tree. */
  const clearPropsNear=(x,z,r)=>{
    for(let i=pr.length-1;i>=0;i--){
      const o=pr[i];
      if(Math.hypot(o.position.x-x,o.position.z-z)>r)continue;
      scene.remove(o);
      const gi=props.indexOf(o); if(gi>=0)props.splice(gi,1);
      pr.splice(i,1);
    }
  };
  const bl=[],sh=[];
  if(World.name==='earth'&&Math.random()<0.32){
    const wx=ox+8+Math.random()*(CHUNK-16), wz=oz+8+Math.random()*(CHUNK-16);
    const sm=sample(wx,wz);
    if(sm.biome!=='water'&&sm.h<20&&sm.h>=WATER_Y+1.6&&roadDist(wx,wz)>ROAD_HW+9){
      const kind=sm.biome==='plains'?'barn':'camp';
      const b=buildBuilding(kind);
      b.position.set(wx,sm.h,wz);b.rotation.y=Math.random()*6.28;
      clearPropsNear(wx,wz,9);
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
  /* ---- roads: deck geometry, then roadside population (Earth only) ---- */
  const vh=[],rd=[];
  if(World.name==='earth'){
    for(const c of roadsNear(ox,oz,CHUNK)){
      // t-range of this corridor that overlaps the chunk, padded so decks from
      // neighbouring chunks meet without a visible seam.
      const t0=(c.axis==='x'?ox:oz)-STEP, t1=(c.axis==='x'?ox+CHUNK:oz+CHUNK)+STEP;
      // Does the routed line actually enter this chunk? A corridor can be
      // pulled far enough sideways dodging a mountain that it misses entirely.
      let inside=false;
      for(let t=t0;t<=t1&&!inside;t+=STEP){
        const sp=roadSample(c.axis,c.k,t);
        if(sp.x>=ox-6&&sp.x<=ox+CHUNK+6&&sp.z>=oz-6&&sp.z<=oz+CHUNK+6)inside=true;
      }
      if(!inside)continue;
      const m=buildRoadMesh(c.axis,c.k,t0,t1,roadMat,pierMat);
      scene.add(m);rd.push(m);

      // one station per chunk at most, beside this road
      if(Math.random()<STATION_CHANCE&&!bl.some(o=>o.userData.station)){
        const t=t0+Math.random()*(t1-t0);
        const sp=roadSample(c.axis,c.k,t);
        const side=Math.random()<0.5?1:-1, off=ROAD_HW+8;
        const sx=sp.x+sp.fz*off*side, sz=sp.z-sp.fx*off*side;
        const sm2=sample(sx,sz);
        if(sm2.biome!=='water'&&sm2.biome!=='mountain'&&sm2.h>WATER_Y+1){
          const st=buildStation();
          clearPropsNear(sx,sz,13);
          st.position.set(sx,sm2.h,sz);
          st.rotation.y=Math.atan2(-sp.fz*side,sp.fx*side);   // forecourt toward the road
          scene.add(st);bl.push(st);buildings.push(st);
          const shel={x:sx,z:sz};shelters.push(shel);sh.push(shel);
          const nh=2+((Math.random()*2)|0);
          for(let h=0;h<nh;h++){
            const hx=sx+(Math.random()-0.5)*11, hz=sz+(Math.random()-0.5)*11;
            const sm3=sample(hx,hz);
            if(sm3.biome==='water')continue;
            const hu=buildHuman('villager');
            hu.userData.scatter=1;
            hu.position.set(hx,sm3.h,hz);hu.rotation.y=hu.userData.face;
            scene.add(hu);animals.push(hu);spawned.push(hu);
          }
        }
      }
      // traffic
      for(let i=0;i<VEH_PER_CHUNK;i++){
        if(Math.random()<0.45)continue;
        const t=t0+Math.random()*(t1-t0);
        const roll=Math.random();
        const kind=roll<0.45?'car1':roll<0.8?'car2':'bus1';
        const v=buildVehicle(kind);
        placeVehicle(v,c.axis,c.k,t,Math.random()<0.5?1:-1);
        scene.add(v);vh.push(v);
      }
    }
  }
  chunks.set(chunkKey(cx,cz),{mesh,animals:spawned,pickups:pk,props:pr,builds:bl,shel:sh,vehs:vh,roads:rd});
}

export function updateChunks(px,pz){
  // The ground material compiles once and is shared, so anything that changes
  // after that has to be pushed through its uniforms rather than a rebuild:
  // the road gate when the world changes, and the texture handles when the
  // high-detail toggle loads custom images mid-session.
  const sh=groundMat.userData.sh;
  if(sh&&sh.uniforms.tGrass){
    if(TEX.grass)   sh.uniforms.tGrass.value=TEX.grass;
    if(TEX.sand)    sh.uniforms.tSand.value =TEX.sand;
    if(TEX.mountain)sh.uniforms.tRock.value =TEX.mountain;
  }
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
      (c.vehs||[]).forEach(o=>{scene.remove(o);const idx=vehicles.indexOf(o);if(idx>=0)vehicles.splice(idx,1);});
      (c.roads||[]).forEach(o=>{scene.remove(o);o.traverse(q=>{if(q.geometry)q.geometry.dispose();});});
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
    c.builds.forEach(o=>scene.remove(o));
    (c.vehs||[]).forEach(o=>scene.remove(o));
    (c.roads||[]).forEach(o=>{scene.remove(o);o.traverse(q=>{if(q.geometry)q.geometry.dispose();});});}
  clearRoadCache();
  chunks.clear();animals.length=0;pickups.length=0;props.length=0;buildings.length=0;vehicles.length=0;shelters.length=0;
}
