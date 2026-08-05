/* =========================================================================
   CHUNK MANAGER — the infinite streamed world. Each chunk is a colored,
   texture-splatted terrain tile that also spawns creatures, crystals, props,
   buildings, and humans; chunks load/unload around the ship.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { CHUNK, SEG, WATER_Y, MTN_H, GROUND_TILING, VEH_PER_CHUNK, STATION_CHANCE, PROP_ROAD_GAP,
         SPAWN_DENSITY, RESTRICT_R } from '../core/constants.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { SPAWN_CLEAR } from './spawn.js';
import { disposeDeep } from '../core/dispose.js';
import { World } from './world-config.js';
import { sample, goodGround, slopeAt, walkableGround } from './terrain.js';
import { TEX, grassTex, sandTex, rockTex, snowTex } from './textures.js';
import { ROAD_HW, STEP, roadsNear, roadSample, buildRoadMesh, clearRoadCache, roadTex, junctionTex, roadDist, roadWidth, junctionsIn } from './roads.js';
import { animals, pickups, props, buildings, vehicles, shelters, structures } from '../entities/registry.js';
import { spawnSettlementParts, clearSettlementCache, inSettlement, settlementsNear } from './settlements.js';
import { spawnFieldParts, clearFieldCache, inField } from './fields.js';
import { monumentsNear, clearMonumentCache, inMonument, sphinxPos } from './monuments.js';
import { buildAnimal } from '../entities/animals.js';
import { buildAlien } from '../entities/aliens.js';
import { buildCrystal } from '../entities/crystals.js';
import { buildProp } from '../entities/props.js';
import { buildBuilding, buildHuman } from '../entities/humans.js';
import { buildStation } from '../entities/stations.js';
import { buildBillboard } from '../entities/billboards.js';
import { buildArea51Sign } from '../entities/area51.js';
import { buildPyramid, buildSphinx, PYRAMID_R } from '../entities/egypt.js';
import { buildVehicle, placeVehicle } from '../entities/vehicles.js';
import { streetLamp } from '../systems/nightlights.js';

const LOW_END = env.LOW_END;
const LAMP_S = 54;        // spacing between street lamps along a road corridor

/* Inside the restricted area around the landing site, nothing MAN-MADE is
   generated. Deliberately not folded into clearSpot: cacti, wildlife and
   crystals belong in the zone — a lamp post, a hoarding or a fuel station is
   what would spoil "the middle of the desert". The one exception is the Area 51
   sign itself, which is the reason the zone exists. */
const inRestricted=(x,z,r=0)=>x*x+z*z<(RESTRICT_R+r)*(RESTRICT_R+r);

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
      +'diffuseColor.rgb*=mix(vec3(1.0),tc*1.45,0.9);\n}');
};

/* NOTE: the ground shader multiplies the splat texture into the vertex colour.
   That factor is deliberately BELOW 2 — the biome tints are saturated now, and a
   bigger multiplier clips bright ground (sand, snow) to white, which destroys the
   very hue the palette is trying to show. */

/* Road surface. A separate raised mesh, so it never blends with the ground.
   The terrain shader multiplies its texture by ~1.45; the deck is lifted to
   match so it neither reads as a black slash nor as a blown-out white ribbon
   across the saturated ground. */
const roadMat=new THREE.MeshStandardMaterial({map:roadTex,roughness:0.93,metalness:0.02,side:THREE.DoubleSide});
roadMat.color.setScalar(1.32);
const pierMat=new THREE.MeshStandardMaterial({color:0x53565c,roughness:0.95});
pierMat.color.multiplyScalar(1.15);
/* Crossroad node — the paved patch that fills the overlap where two
   carriageways cross, so the intersection reads as one clean junction instead of
   two ribbons z-fighting with their lane stripes doubled up. It uses the SAME
   asphalt as the road (junctionTex, unmarked) and is an octagon sized to the
   carriageway width: its four flats butt up to the four road arms and its four
   chamfers cut the corners, so it seats seamlessly rather than sitting proud as
   an oversized square. */
const junctionMat=new THREE.MeshStandardMaterial({map:junctionTex,roughness:0.93,metalness:0.02});
junctionMat.color.setScalar(1.32);
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

// Mobile (LOW_END) uses a slightly coarser mesh than desktop so the per-chunk
// build (SEG² terrain samples) stays cheap while streaming — still much finer
// than the old 14, so shorelines/slopes read smoother without a build hitch.
const MESH_SEG = LOW_END ? 22 : SEG;
export function buildChunk(cx,cz){
  const geo=new THREE.PlaneGeometry(CHUNK,CHUNK,MESH_SEG,MESH_SEG);
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
  /* A town owns its ground: nothing else — no tree, animal, crystal, barn,
     billboard or station — is placed inside one. Roads and their traffic are
     the deliberate exception, so the street through the middle stays live. */
  /* `inTown` opts out of the settlement test, and ONLY the village's own
     residents may use it — everything else in the world stays outside the
     footprint. Without it a village could not be populated at all: the rule
     that keeps trees out of the high street kept the villagers out too. */
  const clearSpot=(x,z,r,inTown)=>{
    if(!inTown&&inSettlement(x,z,r+4))return false;
    if(inField(x,z,r+1))return false;              // nothing grows in the crop
    if(inMonument(x,z,r+2))return false;           // nor out of the masonry
    // ...and so does the landing site: collision.js only looks 24 units out, so
    // an empty disc here means the arrival cannot end on a lamp post.
    const sdx=x-S.spawnX, sdz=z-S.spawnZ;
    if(sdx*sdx+sdz*sdz<SPAWN_CLEAR*SPAWN_CLEAR)return false;
    for(const p of placed){const dx=p.x-x,dz=p.z-z; if(dx*dx+dz*dz<(p.r+r)*(p.r+r))return false;}
    return true; };
  const mark=(x,z,r)=>placed.push({x,z,r});
  // A building needs roughly level ground under its footprint.
  const flatEnough=(x,z,r)=>{const h0=sample(x,z).h; for(const d of [[r,0],[-r,0],[0,r],[0,-r]])if(Math.abs(sample(x+d[0],z+d[1]).h-h0)>3.5)return false; return true;};
  // SPAWN_DENSITY thins every population uniformly (never below one attempt).
  const dens=n=>Math.max(1,Math.round(n*SPAWN_DENSITY));

  /* PEOPLE LIVE SOMEWHERE. Every NPC in the world comes from here, and every
     caller passes the thing they came out of — a village, a farmhouse, a desert
     camp, a filling station. There is no spawner that puts a person in open
     country any more.

     That is not only a plausibility fix. A frightened human runs for the
     nearest shelter (see humans.js), so one dropped in the middle of nowhere
     had nothing to run to and jogged toward the horizon until the chunk
     unloaded. Anchoring them to a building means the flee behaviour has
     somewhere to send them, which is what it was written for. */
  const populate=(cx,cz,spread,n,kind,list,bag,tweak,inTown)=>{
    for(let i=0;i<n;i++){
      const hx=cx+(Math.random()-0.5)*spread, hz=cz+(Math.random()-0.5)*spread;
      if(!walkableGround(hx,hz))continue;      // same test their feet obey once alive
      if(roadDist(hx,hz)<ROAD_HW+1.5)continue; // not standing in the carriageway
      if(!clearSpot(hx,hz,1.6,inTown))continue;
      const hu=buildHuman(kind);
      hu.position.set(hx,sample(hx,hz).h,hz);
      hu.rotation.y=hu.userData.face;
      if(tweak)tweak(hu);
      scene.add(hu);list.push(hu);bag.push(hu);mark(hx,hz,1.4);
    }
  };

  /* Villages and cities go down FIRST, claiming their footprints, so every
     scenery pass below naturally routes around them (rather than a lone barn's
     approach of deleting the trees it landed on). They stream per chunk but are
     positioned globally — see world/settlements.js. */
  const st=[], mons=[], sh=[];
  if(World.name==='earth'){
    for(const o of spawnSettlementParts(ox,oz,CHUNK,(obj,x,z,r)=>{
      mark(x,z,r);
      // Every house is somewhere to run to. Villages had no shelters at all
      // before, which is why a village had no people: there was nowhere for
      // them to go, so nothing put them there.
      if(obj.userData.shelter){ const s={x,z}; shelters.push(s); sh.push(s); }
    })){
      scene.add(o); st.push(o); structures.push(o);
    }
    /* THE PEOPLE WHO LIVE IN THEM. Settlements used to be empty streets — every
       NPC in town was one of the scattered wanderers from the animal table, so
       deleting those emptied the towns entirely. A village is now populated
       from its own centre, which is also the only place `inTown` is granted. */
    for(const s of settlementsNear(ox,oz,CHUNK)){
      if(s.x<ox||s.x>=ox+CHUNK||s.z<oz||s.z>=oz+CHUNK)continue;   // one chunk owns it
      populate(s.x,s.z,s.r*1.5,dens(4+((Math.random()*4)|0)),'villager',
               animals,spawned,null,true);
    }
    // Farmland goes down with them — two batched meshes per chunk, and clearSpot
    // then keeps every later pass out of the crop.
    for(const o of spawnFieldParts(ox,oz,CHUNK)){ scene.add(o); st.push(o); }

    /* Monuments. A pyramid is far wider than a chunk, so it is instantiated by
       the chunk containing its CENTRE and simply overhangs its neighbours —
       splitting it would mean four meshes and a seam. Its ground is claimed in
       every chunk it reaches (see inMonument in clearSpot), which is what keeps
       cacti from growing out of the masonry. */
    for(const m of monumentsNear(ox,oz,CHUNK)){
      if(m.x<ox||m.x>=ox+CHUNK||m.z<oz||m.z>=oz+CHUNK)continue;
      const py=buildPyramid();
      py.position.set(m.x,m.y-1.5,m.z);      // seated slightly into the sand
      py.rotation.y=m.ang*0.25;              // barely off-axis, like a real survey error
      scene.add(py);mons.push(py);buildings.push(py);
      if(m.sphinx){
        const sp=sphinxPos(m);
        const sx=buildSphinx();
        sx.position.set(sp.x,sample(sp.x,sp.z).h-0.6,sp.z);
        sx.rotation.y=m.ang+Math.PI;         // facing away from the pyramid, out east
        scene.add(sx);mons.push(sx);buildings.push(sx);
      }
    }
  }

  const tries=dens(LOW_END?4:7);
  for(let t=0;t<tries;t++){
    const wx=ox+Math.random()*CHUNK, wz=oz+Math.random()*CHUNK;
    const sm=sample(wx,wz);
    let a;
    if(World.name==='earth'){
      const w=sm.biome;
      let species;
      if(w==='water'){
        if(!goodGround(wx,wz,{water:true,slope:0.6}))continue;   // shallows, not mid-lake or a steep bank
        species='Duck';
      }else if(sm.wDes>0.5){
        /* THE DESERT'S ONLY WILDLIFE IS THE VULTURE. Nothing grazes on sand and
           nothing small lives on it either — a few big slow shapes turning high
           up and the occasional camel is the whole population, and that
           emptiness is what the region is for. */
        if(Math.random()>0.24)continue;
        // camels want ground a camel could stand on; vultures do not care
        species=(Math.random()<0.42&&slopeAt(wx,wz)<0.4)?'Camel':'Vulture';
      }else if(w==='mountain'||w==='canyon'||sm.h>MTN_H-4){
        // high ground only ever occurs in the wilderness, so its bird is the
        // wilderness bird
        if(Math.random()>0.20)continue;
        species='Bird';
      }else{
        // plains / forest: kept off the road, never on a cliff edge or lip
        if(roadDist(wx,wz)<ROAD_HW+3)continue;
        if(slopeAt(wx,wz)>0.5)continue;
        if(Math.random()>0.58-sm.wUrb*0.18)continue;
        const r=Math.random();
        /* Each land has its own catch and NOTHING crosses. The test is on the
           region WEIGHT rather than on the terrain biome, because a biome label
           flips at the middle of the blend while the weight is what actually
           says which land this is — keying off the label let a vulture spawn on
           sand that was already wilderness underneath.

           WILDERNESS is flocks and the people who keep them; SETTLED COUNTRY has
           no flocks at all, so what walks about there is people. Birds are in
           both by design (they are the one thing that is genuinely everywhere);
           the vulture and the camel are desert-only, the sheep wilderness-only. */
        /* NO PEOPLE IN THIS TABLE. A person standing alone in open country with
           nothing around them for half a kilometre is not a person, it is a
           prop — and the flee behaviour makes it worse, because they run for
           the nearest shelter and there is not one. Everybody now spawns at
           something they could plausibly have come out of: a village, a farm,
           a desert camp or a filling station. See the spawners below. */
        if(sm.wUrb>0.5) species=r<0.55?'Bird':null;
        else            species=r<0.16?'Bird':r<0.82?'Sheep':null;
        if(!species)continue;
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
  if(Math.random()<0.38*SPAWN_DENSITY){
    const ccx2=ox+Math.random()*CHUNK, ccz2=oz+Math.random()*CHUNK;
    const nCr=dens(2+((Math.random()*3)|0));
    for(let k=0;k<nCr;k++){
      const wx=ccx2+(Math.random()-0.5)*10, wz=ccz2+(Math.random()-0.5)*10;
      const sm=sample(wx,wz);
      // no crystals in the water, on a cliff edge or up a mountain
      if(World.name==='earth'&&!goodGround(wx,wz))continue;
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
  const propTries=dens(LOW_END?6:12);
  for(let t=0;t<propTries;t++){
    const wx=ox+Math.random()*CHUNK, wz=oz+Math.random()*CHUNK;
    const sm=sample(wx,wz);
    if(World.name==='earth'){
      if(sm.biome==='water')continue;
      // The shore band is still land but renders as wet sand — keep scenery above it.
      if(sm.h<WATER_Y+1.6)continue;
      // Density per biome, then thinned by how urban the ground is. Woods belong
      // to the wilderness; a town keeps single specimen trees in its gaps and
      // along its verges, never a canopy. Same tree model, different spacing —
      // which is all "separate trees rather than forests" actually needs.
      let dens=sm.biome==='forest'?0.95:sm.biome==='desert'?0.42:sm.biome==='canyon'?0.20
              :sm.biome==='mountain'?0.10:0.30;   // plains
      dens*=1-sm.wUrb*0.62;
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
  const bl=mons;

  /* The Area 51 sign: one per world. WHERE it stands was decided by
     world/spawn.js before the world streamed, because the ship's opening heading
     is aimed at it; all this does is put the mesh at the answer, in whichever
     chunk contains it. It goes down before the random building roll so it always
     gets its ground. */
  if(World.name==='earth'&&S.signX!=null
     &&S.signX>=ox&&S.signX<ox+CHUNK&&S.signZ>=oz&&S.signZ<oz+CHUNK){
    const sg=buildArea51Sign();
    sg.position.set(S.signX,sample(S.signX,S.signZ).h,S.signZ);
    // local +Z is the printed face, so aim it back at the landing site
    sg.rotation.y=Math.atan2(S.spawnX-S.signX,S.spawnZ-S.signZ);
    mark(S.signX,S.signZ,6);
    scene.add(sg);bl.push(sg);buildings.push(sg);
  }
  if(World.name==='earth'&&Math.random()<0.32){
    const wx=ox+8+Math.random()*(CHUNK-16), wz=oz+8+Math.random()*(CHUNK-16);
    const sm=sample(wx,wz);
    if(sm.biome!=='water'&&sm.biome!=='canyon'&&sm.biome!=='mountain'&&sm.h<20&&sm.h>=WATER_Y+1.6
       &&!inRestricted(wx,wz,11)&&roadDist(wx,wz)>ROAD_HW+9&&clearSpot(wx,wz,11)&&flatEnough(wx,wz,9)){
      // What a lone building out in the country IS depends on the country. The
      // wilderness gets working farmsteads; town land gets houses and the odd
      // water tower, and never a windmill.
      const kind=sm.biome==='desert'?'camp'
        :sm.wUrb>0.5?['house','house','house','watertower','barn','house'][(Math.random()*6)|0]
        :['barn','house','watertower','windmill','house','barn'][(Math.random()*6)|0];
      const b=buildBuilding(kind);
      b.position.set(wx,sm.h,wz);b.rotation.y=Math.random()*6.28;
      clearPropsNear(wx,wz,10);mark(wx,wz,10);
      scene.add(b);bl.push(b);buildings.push(b);
      const shel={x:wx,z:wz};shelters.push(shel);sh.push(shel);
      populate(wx,wz,18,1+((Math.random()*2)|0),
               kind==='barn'?'villager':kind==='camp'?'villager':'hiker',
               animals,spawned);
    }
  }
  /* ---- roads: deck geometry, then roadside population (Earth only) ---- */
  const vh=[],rd=[];
  let billboardPlaced=false;
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
          // plant the post right on the carriageway EDGE (the arm reaches inward)
          const side=(n&1)?1:-1, off=ROAD_HW+0.3;
          const lx=sp.x+sp.fz*off*side, lz=sp.z-sp.fx*off*side;
          const sm2=sample(lx,lz);
          if(sm2.biome==='water')continue;                               // no lamp posts in a lake
          if(sp.y-sm2.h>3)continue;                                      // road is a bridge here — no floating pole
          if(inSettlement(lx,lz,6))continue;                             // the town lights its own streets
          if(inRestricted(lx,lz,4))continue;
          // Street lighting is an URBAN thing. Outside town there is no deck to
          // light anyway (see roadHere in world/roads.js), and a lit verge in
          // open desert was the single most town-like thing in the wilderness.
          /* roadHere() with no corridor returns the OPTIMISTIC width — it
             assumes the corridor runs — so a lamp on a wilderness corridor that
             does not actually carry tarmac still passed it, which is how lamps
             ended up standing in open country with no road beside them. Ask
             about THIS corridor. */
          if(roadWidth(lx,lz,c.axis,c.k)<=0.12)continue;
          if((lx-S.spawnX)**2+(lz-S.spawnZ)**2<SPAWN_CLEAR*SPAWN_CLEAR)continue;   // never on the landing site
          const lamp=streetLamp();
          lamp.position.set(lx,sm2.h,lz);                                // base sits on the ground at the edge
          lamp.rotation.y=Math.atan2(-sp.fx*side,-sp.fz*side);           // arm/pool reach over the road
          scene.add(lamp);bl.push(lamp);buildings.push(lamp);            // solid crash object (see collision)
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
           &&roadWidth(sx,sz,c.axis,c.k)>0.12     // urban only, and on THIS corridor
           &&!inRestricted(sx,sz,12)&&clearSpot(sx,sz,12)&&flatEnough(sx,sz,9)){
          const st=buildStation();
          clearPropsNear(sx,sz,13);mark(sx,sz,11);
          st.position.set(sx,sm2.h,sz);
          st.rotation.y=Math.atan2(-sp.fz*side,sp.fx*side);   // forecourt toward the road
          scene.add(st);bl.push(st);buildings.push(st);
          const shel={x:sx,z:sz};shelters.push(shel);sh.push(shel);
          // the forecourt crowd — who now run into the shop like everyone else
          populate(sx,sz,12,2+((Math.random()*2)|0),'villager',animals,spawned);
        }
      }
      // a roadside billboard — tall, solid crash hazard beside the tarmac
      if(!billboardPlaced&&Math.random()<0.5){
        const bt=t0+Math.random()*(t1-t0), sp=roadSample(c.axis,c.k,bt);
        if(sp.x>=ox&&sp.x<ox+CHUNK&&sp.z>=oz&&sp.z<oz+CHUNK){
          const side=Math.random()<0.5?1:-1, off=ROAD_HW+4.5;
          const bx=sp.x+sp.fz*off*side, bz=sp.z-sp.fx*off*side;
          const sm2=sample(bx,bz);
          // only on FLAT dry ground beside a ground-level road — never over sea,
          // in a canyon, on a mountain, or where the road bridges/embanks above it
          if(sm2.biome!=='water'&&sm2.biome!=='mountain'&&sm2.biome!=='canyon'
             &&sm2.h>WATER_Y+1&&Math.abs(sp.y-sm2.h)<2.5
             /* THIS corridor's width, not roadHere's. roadHere() asks the
                axis-agnostic question, which returns the widest the road could
                be anywhere along that axis — so a hoarding passed the test on
                stretches where this particular corridor had already tapered to
                nothing, and ended up standing alone in open country facing a
                road that was not there. Same defect that put street lamps in
                empty fields. */
             &&roadWidth(bx,bz,c.axis,c.k)>0.12
             &&!inRestricted(bx,bz,5)&&clearSpot(bx,bz,5)&&flatEnough(bx,bz,5)){
            const bb=buildBillboard();
            clearPropsNear(bx,bz,5);mark(bx,bz,4);
            bb.position.set(bx,sm2.h,bz);
            bb.rotation.y=Math.atan2(sp.fx,sp.fz);   // sign face turned ALONG the road
            scene.add(bb);bl.push(bb);buildings.push(bb);
            billboardPlaced=true;
          }
        }
      }
      // traffic
      for(let i=0;i<VEH_PER_CHUNK;i++){
        if(Math.random()<1-(1-0.45)*SPAWN_DENSITY)continue;   // ~55% take, thinned by SPAWN_DENSITY
        const t=t0+Math.random()*(t1-t0);
        // no deck out here means no traffic on it — again, THIS corridor's width
        const at=roadSample(c.axis,c.k,t);
        if(roadWidth(at.x,at.z,c.axis,c.k)<=0.12)continue;
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
  chunks.set(chunkKey(cx,cz),{mesh,animals:spawned,pickups:pk,props:pr,builds:bl,shel:sh,vehs:vh,roads:rd,structs:st});
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
      // Free the GPU side too: scene.remove() alone drops the JS reference but
      // leaves the buffers/textures allocated, which is what made a long session
      // creep upward. disposeDeep only frees per-instance resources (see
      // core/dispose.js), so shared lamp/headlight assets are untouched.
      scene.remove(c.mesh);c.mesh.geometry.dispose();
      c.animals.forEach(a=>{scene.remove(a);disposeDeep(a);const idx=animals.indexOf(a);if(idx>=0)animals.splice(idx,1);});
      c.pickups.forEach(o=>{scene.remove(o);disposeDeep(o);const idx=pickups.indexOf(o);if(idx>=0)pickups.splice(idx,1);});
      c.props.forEach(o=>{scene.remove(o);disposeDeep(o);const idx=props.indexOf(o);if(idx>=0)props.splice(idx,1);});
      c.builds.forEach(o=>{scene.remove(o);disposeDeep(o);const idx=buildings.indexOf(o);if(idx>=0)buildings.splice(idx,1);});
      (c.vehs||[]).forEach(o=>{scene.remove(o);disposeDeep(o);const idx=vehicles.indexOf(o);if(idx>=0)vehicles.splice(idx,1);});
      (c.structs||[]).forEach(o=>{scene.remove(o);disposeDeep(o);const idx=structures.indexOf(o);if(idx>=0)structures.splice(idx,1);});
      (c.roads||[]).forEach(o=>{scene.remove(o);o.traverse(q=>{if(q.geometry)q.geometry.dispose();});disposeDeep(o);});
      c.shel.forEach(s=>{const idx=shelters.indexOf(s);if(idx>=0)shelters.splice(idx,1);});
      chunks.delete(k);
    }
  }
}
export function clearWorld(){
  for(const [k,c] of chunks){scene.remove(c.mesh);c.mesh.geometry.dispose();
    c.animals.forEach(a=>{scene.remove(a);disposeDeep(a);});
    c.pickups.forEach(o=>{scene.remove(o);disposeDeep(o);});
    c.props.forEach(o=>{scene.remove(o);disposeDeep(o);});
    c.builds.forEach(o=>{scene.remove(o);disposeDeep(o);});
    (c.vehs||[]).forEach(o=>{scene.remove(o);disposeDeep(o);});
    (c.structs||[]).forEach(o=>{scene.remove(o);disposeDeep(o);});
    (c.roads||[]).forEach(o=>{scene.remove(o);o.traverse(q=>{if(q.geometry)q.geometry.dispose();});disposeDeep(o);});}
  clearRoadCache();clearSettlementCache();clearFieldCache();clearMonumentCache();
  chunks.clear();animals.length=0;pickups.length=0;props.length=0;buildings.length=0;vehicles.length=0;shelters.length=0;structures.length=0;
}
