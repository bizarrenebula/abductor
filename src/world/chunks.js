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
import { ROAD_HW, STEP, roadsNear, roadSample, buildRoadMesh, clearRoadCache, roadTex, junctionTex, roadDist, junctionsIn } from './roads.js';
import { animals, pickups, props, buildings, vehicles, shelters } from '../entities/registry.js';
import { buildAnimal } from '../entities/animals.js';
import { buildAlien } from '../entities/aliens.js';
import { buildCrystal } from '../entities/crystals.js';
import { buildProp } from '../entities/props.js';
import { buildBuilding, buildHuman } from '../entities/humans.js';
import { buildStation } from '../entities/stations.js';
import { buildVehicle, placeVehicle } from '../entities/vehicles.js';
import { streetLamp } from '../systems/nightlights.js';

const LOW_END = env.LOW_END;
const LAMP_S = 54;        // spacing between street lamps along a road corridor

export const chunks=new Map();
export function chunkKey(cx,cz){return cx+'|'+cz;}

const groundMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.98,metalness:0.02,flatShading:true});
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
/* Crossroad node — the paved patch that fills the overlap where two
   carriageways cross, so the intersection reads as one clean junction instead of
   two ribbons z-fighting with their lane stripes doubled up. It uses the SAME
   asphalt as the road (junctionTex, unmarked) and is an octagon sized to the
   carriageway width: its four flats butt up to the four road arms and its four
   chamfers cut the corners, so it seats seamlessly rather than sitting proud as
   an oversized square. */
const junctionMat=new THREE.MeshStandardMaterial({map:junctionTex,roughness:0.93,metalness:0.02});
junctionMat.color.setScalar(1.85);
const JUNC_R=ROAD_HW*1.12;               // octagon radius: flats ~ at the road edge
// octagon deck, laid flat, a flat side facing each axis (rotate 22.5°)
const junctionGeo=new THREE.CircleGeometry(JUNC_R,8);
junctionGeo.rotateX(-Math.PI/2);junctionGeo.rotateY(Math.PI/8);
// map the plain asphalt across it at road-ish scale so the speckle density matches
(function(){
  const uv=junctionGeo.attributes.uv, s=0.5/JUNC_R, pos=junctionGeo.attributes.position;
  for(let i=0;i<uv.count;i++)uv.setXY(i, pos.getX(i)*s+0.5, pos.getZ(i)*s+0.5);
  uv.needsUpdate=true;
})();

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
  // Occupancy: solid objects claim a footprint radius; a new object is only
  // placed where it doesn't overlap an already-placed one, so nothing fuses.
  const placed=[];
  const clearSpot=(x,z,r)=>{ for(const p of placed){const dx=p.x-x,dz=p.z-z; if(dx*dx+dz*dz<(p.r+r)*(p.r+r))return false;} return true; };
  const mark=(x,z,r)=>placed.push({x,z,r});
  // A building needs roughly level ground under its footprint.
  const flatEnough=(x,z,r)=>{const h0=sample(x,z).h; for(const d of [[r,0],[-r,0],[0,r],[0,-r]])if(Math.abs(sample(x+d[0],z+d[1]).h-h0)>3.5)return false; return true;};
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
      // Ground animals keep clear of solids so they don't spawn inside a tree.
      if(!a.userData.fly && !clearSpot(wx,wz,2.2))continue;
      a.position.set(wx, a.userData.fly?Math.max(sm.h,WATER_Y)+a.userData.hover
                        :(w==='water'?WATER_Y+0.15:sm.h), wz);
      if(!a.userData.fly)mark(wx,wz,1.8);
    }else{
      if(Math.random()>0.5) continue;
      const roll=Math.random();
      const form=World.name==='moon'
        ?(roll<0.45?'blob':roll<0.8?'crawler':'skimmer')
        :(roll<0.4?'strider':roll<0.7?'wormling':'tumbler');
      a=buildAlien(form);
      if(!clearSpot(wx,wz,2.0))continue;
      a.position.set(wx,sm.h+(a.userData.hover||0),wz);
      mark(wx,wz,1.8);
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
      if(!clearSpot(wx,wz,1.4))continue;     // not inside a tree/rock/animal
      const item=buildCrystal();
      const by=sm.h-0.45;                    // semi-buried
      item.position.set(wx,by,wz);item.userData.baseY=by;
      item.rotation.y=Math.random()*6.28;
      scene.add(item);pickups.push(item);pk.push(item);mark(wx,wz,1.3);
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
    if(!clearSpot(wx,wz,2.4))continue;        // keep scenery from fusing together
    const prop=buildProp(sm.biome);
    prop.position.set(wx,sm.h,wz);prop.userData.baseY=sm.h;
    prop.rotation.y=Math.random()*6.28;
    scene.add(prop);props.push(prop);pr.push(prop);mark(wx,wz,2.1);
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
    if(sm.biome!=='water'&&sm.biome!=='canyon'&&sm.biome!=='mountain'&&sm.h<20&&sm.h>=WATER_Y+1.6
       &&roadDist(wx,wz)>ROAD_HW+9&&clearSpot(wx,wz,11)&&flatEnough(wx,wz,9)){
      const kind=sm.biome==='desert'?'camp':['barn','house','watertower','windmill','house','barn'][(Math.random()*6)|0];
      const b=buildBuilding(kind);
      b.position.set(wx,sm.h,wz);b.rotation.y=Math.random()*6.28;
      clearPropsNear(wx,wz,10);mark(wx,wz,10);
      scene.add(b);bl.push(b);buildings.push(b);
      const shel={x:wx,z:wz};shelters.push(shel);sh.push(shel);
      const nh=1+((Math.random()*2)|0);
      for(let h=0;h<nh;h++){
        const hx=wx+(Math.random()-0.5)*18, hz=wz+(Math.random()-0.5)*18;
        const sm2=sample(hx,hz);
        if(sm2.biome==='water'||sm2.biome==='mountain'||sm2.biome==='canyon')continue;
        if(!clearSpot(hx,hz,1.6))continue;
        const hu=buildHuman(kind==='barn'?'villager':'hiker');
        hu.position.set(hx,sm2.h,hz);hu.rotation.y=hu.userData.face;
        scene.add(hu);animals.push(hu);spawned.push(hu);mark(hx,hz,1.4);
      }
    }
  }else if(World.name==='earth'&&Math.random()<0.1){
    const wx=ox+Math.random()*CHUNK, wz=oz+Math.random()*CHUNK;
    const sm=sample(wx,wz);
    if((sm.biome==='plains'||sm.biome==='forest')&&roadDist(wx,wz)>ROAD_HW+3&&clearSpot(wx,wz,1.6)){
      const hu=buildHuman('hiker');
      hu.position.set(wx,sm.h,wz);
      scene.add(hu);animals.push(hu);spawned.push(hu);mark(wx,wz,1.4);
    }
  }
  /* ---- roads: deck geometry, then roadside population (Earth only) ---- */
  const vh=[],rd=[],li=[];
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

      // Street lamps: deterministic stations every LAMP_S along the corridor, so
      // neighbouring chunks never double up. Only the ones landing in THIS chunk
      // are planted here; they light up at night (dark posts by day).
      { const cS=(c.axis==='x'?ox:oz);
        const n0=Math.ceil(cS/LAMP_S), n1=Math.floor((cS+CHUNK-0.001)/LAMP_S);
        for(let n=n0;n<=n1;n++){
          const lt=n*LAMP_S, sp=roadSample(c.axis,c.k,lt);
          if(sp.x<ox||sp.x>=ox+CHUNK||sp.z<oz||sp.z>=oz+CHUNK)continue;   // road dodged out of chunk
          const side=(n&1)?1:-1, off=ROAD_HW+1.4;
          const lx=sp.x+sp.fz*off*side, lz=sp.z-sp.fx*off*side;
          const sm2=sample(lx,lz);
          if(sm2.biome==='water')continue;                               // no lamp posts in a lake
          const lamp=streetLamp();
          lamp.position.set(lx,Math.max(sm2.h,sp.y),lz);
          lamp.rotation.y=Math.atan2(-sp.fx*side,-sp.fz*side);           // arm/pool reach over the road
          scene.add(lamp);li.push(lamp);
        }
      }

      // one station per chunk at most, beside this road
      if(Math.random()<STATION_CHANCE&&!bl.some(o=>o.userData.station)){
        const t=t0+Math.random()*(t1-t0);
        const sp=roadSample(c.axis,c.k,t);
        const side=Math.random()<0.5?1:-1, off=ROAD_HW+8;
        const sx=sp.x+sp.fz*off*side, sz=sp.z-sp.fx*off*side;
        const sm2=sample(sx,sz);
        if(sm2.biome!=='water'&&sm2.biome!=='mountain'&&sm2.biome!=='canyon'&&sm2.h>WATER_Y+1
           &&clearSpot(sx,sz,12)&&flatEnough(sx,sz,9)){
          const st=buildStation();
          clearPropsNear(sx,sz,13);mark(sx,sz,11);
          st.position.set(sx,sm2.h,sz);
          st.rotation.y=Math.atan2(-sp.fz*side,sp.fx*side);   // forecourt toward the road
          scene.add(st);bl.push(st);buildings.push(st);
          const shel={x:sx,z:sz};shelters.push(shel);sh.push(shel);
          const nh=2+((Math.random()*2)|0);
          for(let h=0;h<nh;h++){
            const hx=sx+(Math.random()-0.5)*12, hz=sz+(Math.random()-0.5)*12;
            const sm3=sample(hx,hz);
            if(sm3.biome==='water'||sm3.biome==='mountain'||sm3.biome==='canyon')continue;
            if(!clearSpot(hx,hz,1.6))continue;
            const hu=buildHuman('villager');
            hu.userData.scatter=1;
            hu.position.set(hx,sm3.h,hz);hu.rotation.y=hu.userData.face;
            scene.add(hu);animals.push(hu);spawned.push(hu);mark(hx,hz,1.4);
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
    // crossroad nodes where corridors intersect within this chunk. A LEVEL
    // crossroad gets a flush, unmarked octagon seated on the shared deck (a flat
    // facing each arm) so the roads join and traffic can turn. An OVERPASS gets
    // NO node — one carriageway humps up and flies over the other (the lift is
    // baked into that corridor's deck height), so they must stay separate.
    for(const j of junctionsIn(ox,oz,CHUNK)){
      if(j.overpass)continue;
      // clone the template geo per pad: chunk unload disposes each road geometry,
      // which would free a shared one still used by other chunks' junctions.
      const pad=new THREE.Mesh(junctionGeo.clone(),junctionMat);
      pad.position.set(j.x,j.y+0.05,j.z);pad.rotation.y=j.ang;pad.receiveShadow=true;
      scene.add(pad);rd.push(pad);
    }
  }
  chunks.set(chunkKey(cx,cz),{mesh,animals:spawned,pickups:pk,props:pr,builds:bl,shel:sh,vehs:vh,roads:rd,lights:li});
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
      (c.lights||[]).forEach(o=>scene.remove(o));   // shared geometry — remove only, don't dispose
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
    (c.roads||[]).forEach(o=>{scene.remove(o);o.traverse(q=>{if(q.geometry)q.geometry.dispose();});});
    (c.lights||[]).forEach(o=>scene.remove(o));}
  clearRoadCache();
  chunks.clear();animals.length=0;pickups.length=0;props.length=0;buildings.length=0;vehicles.length=0;shelters.length=0;
}
