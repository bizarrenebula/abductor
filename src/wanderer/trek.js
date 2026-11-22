/* =========================================================================
   THE TREK — where the wanderer is going, and where they can stop on the way.

   A run is a walk of about 5 km along the world's LANE (world/lane.js): the
   same route the saucer game strings its points along, chosen so it crosses
   the regions. At its end is the ESCAPE POINT: a bunker with a radio mast and
   an amber beacon. Reach its door and the run is won.

   Four SAVE POINTS are spaced evenly along the way. Each is a real hiding
   place, picked from what the land offers near that stretch of the route:

     · the space UNDER A BRIDGE, if a road crosses near enough, or
     · a WAYSTATION BARN, built on level ground beside the route

   Each carries a tall green beacon so it can be seen from far off, a ring on
   the ground, a minimap marker and a screen arrow. Being properly inside one —
   in the barn (HIDE / E), or on the ground under the deck — SAVES: the spot
   becomes your respawn, your pulse cell is refilled, and (next step) the
   upgrade shop opens there.

   One "run it back": the first abduction puts you back at the last save point
   (or the start, if you have not reached one). The second ends the run.

   Planned once per run, before any chunk is built, so the save points' ground
   can be reserved (entities/registry.js `reserved`) and no tree or village
   grows into them. Everything is a pure function of the seed and the spawn.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { WATER_Y } from '../core/constants.js';
import { sample, heightAt, goodGround, slopeAt } from '../world/terrain.js';
import { roadHeightAt } from '../world/roads.js';
import { inSettlement } from '../world/settlements.js';
import { laneChain } from '../world/lane.js';
import { buildings, shelters, reserved } from '../entities/registry.js';
import { buildBuilding } from '../entities/humans.js';
import { mark, objectiveGlow, updateGlow } from '../systems/waypoints.js';
import { beep } from '../audio/music.js';
import { banner } from '../ui/banner.js';
import { t } from '../i18n.js';
import { threats } from './threats.js';

export const TREK_LEN=5000;            // units along the route (shown as metres)
const N_SAVES=4;
const SAVE_COL=0x5cffa8, DEST_COL=0xffb040;

export const Trek={
  saves:[],          // {x,z,y,kind:'barn'|'bridge', shelter, reached, glow, beam, objs:[]}
  dest:null,         // {x,z,y, objs:[]}
  last:-1,           // index of the last save point reached (-1: the start)
  lives:1,           // "run it back"s left
  startT:0,
  routeLen:0,
};

/* ---- planning ---- */

/* Where along the route a save point should be, then the best real spot near it. */
function along(poly,cum,dist){
  for(let i=1;i<poly.length;i++){
    if(cum[i]>=dist){
      const k=(dist-cum[i-1])/Math.max(1e-6,cum[i]-cum[i-1]);
      return {x:poly[i-1].x+(poly[i].x-poly[i-1].x)*k, z:poly[i-1].z+(poly[i].z-poly[i-1].z)*k};
    }
  }
  return poly[poly.length-1];
}
const dry=(x,z)=>{ const s=sample(x,z); return s.biome!=='water'&&s.h>WATER_Y+0.4; };
const farFromOthers=(x,z,r)=>reserved.every(q=>Math.hypot(q.x-x,q.z-z)>q.r+r);

/* A dry patch of ground under a raised deck — headroom to stand, not a lake. */
function bridgeSite(cx,cz,R){
  let best=null, bd=Infinity;
  for(let dx=-R;dx<=R;dx+=8)for(let dz=-R;dz<=R;dz+=8){
    const x=cx+dx, z=cz+dz;
    const d=Math.hypot(dx,dz); if(d>R||d>=bd)continue;
    const deck=roadHeightAt(x,z); if(deck<-1e8)continue;
    const g=heightAt(x,z);
    if(deck-g<3.4||!dry(x,z)||slopeAt(x,z,1.5)>0.7)continue;
    if(!farFromOthers(x,z,10))continue;
    bd=d; best={x,z};
  }
  return best;
}
/* Level, open ground for a waystation barn, spiralling out from the route. */
function barnSite(cx,cz){
  for(let r=0;r<=220;r+=12){
    const n=r===0?1:Math.max(8,Math.round(r/6));
    for(let j=0;j<n;j++){
      const a=j/n*Math.PI*2, x=cx+Math.cos(a)*r, z=cz+Math.sin(a)*r;
      if(!goodGround(x,z,{slope:0.3})||!dry(x,z))continue;
      if(inSettlement(x,z,24))continue;
      if(roadHeightAt(x,z)>-1e8)continue;
      const h0=heightAt(x,z); let flat=true;
      for(const d of [[7,0],[-7,0],[0,7],[0,-7]])if(Math.abs(heightAt(x+d[0],z+d[1])-h0)>1.6){flat=false;break;}
      if(!flat||!farFromOthers(x,z,16))continue;
      return {x,z};
    }
  }
  return {x:cx,z:cz};
}

export function planTrek(){
  clearTrek();
  // the route: the landing site, then lane points until the trek length is covered
  const pts=laneChain(16);
  const poly=[{x:S.spawnX,z:S.spawnZ}];
  for(const p of pts){ poly.push(p); if(p.d>=TREK_LEN)break; }
  const cum=[0];
  for(let i=1;i<poly.length;i++)cum.push(cum[i-1]+Math.hypot(poly[i].x-poly[i-1].x,poly[i].z-poly[i-1].z));
  Trek.routeLen=cum[cum.length-1];
  // the escape point: the last lane point (dry, good ground — lanePoint sees to that)
  const end=poly[poly.length-1];
  Trek.dest={x:end.x,z:end.z,y:heightAt(end.x,end.z),objs:[]};
  reserved.push({x:end.x,z:end.z,r:22});
  // save points, evenly along the route
  for(let i=1;i<=N_SAVES;i++){
    const ideal=along(poly,cum,Trek.routeLen*i/(N_SAVES+1));
    const br=bridgeSite(ideal.x,ideal.z,150);
    const site=br?{...br,kind:'bridge'}:{...barnSite(ideal.x,ideal.z),kind:'barn'};
    site.y=heightAt(site.x,site.z);
    site.reached=false; site.objs=[];
    reserved.push({x:site.x,z:site.z,r:site.kind==='barn'?16:10});
    Trek.saves.push(site);
  }
  Trek.last=-1; Trek.lives=1;
}

/* ---- building what was planned (after the world is cleared and seeded) ---- */
function beamColumn(col,h,w){
  const m=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.22,
    blending:THREE.AdditiveBlending,depthWrite:false,fog:false,side:THREE.DoubleSide});
  const g=new THREE.CylinderGeometry(w*0.55,w,h,12,1,true); g.translate(0,h/2,0);
  const b=new THREE.Mesh(g,m); b.frustumCulled=false; return b;
}
function bunker(){
  const g=new THREE.Group();
  const conc=new THREE.MeshStandardMaterial({color:0x2a2b2a,roughness:0.95});
  const dark=new THREE.MeshStandardMaterial({color:0x050505,roughness:1});
  const steel=new THREE.MeshStandardMaterial({color:0x1d2124,roughness:0.6,metalness:0.6});
  const body=new THREE.Mesh(new THREE.BoxGeometry(9,3.2,7),conc); body.position.y=1.0; g.add(body);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(9.6,0.5,7.6),conc); roof.position.y=2.85; g.add(roof);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.8,2.3,0.25),steel); door.position.set(0,0.75,3.55); g.add(door);
  const slot=new THREE.Mesh(new THREE.BoxGeometry(4,0.35,0.2),dark); slot.position.set(0,2.3,3.52); g.add(slot);
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,8),new THREE.MeshBasicMaterial({color:0xffb040}));
  lamp.position.set(0,2.15,3.7); g.add(lamp);
  // radio mast with a blinking red light at the top
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.22,26,6),steel); mast.position.set(-3.2,15,-2); g.add(mast);
  for(let i=0;i<5;i++){ const r=new THREE.Mesh(new THREE.BoxGeometry(1.4,0.08,0.08),steel); r.position.set(-3.2,6+i*4.5,-2); g.add(r); }
  const red=new THREE.Mesh(new THREE.SphereGeometry(0.35,10,8),new THREE.MeshBasicMaterial({color:0xff2a20,fog:false}));
  red.position.set(-3.2,28.2,-2); g.add(red); g.userData.blink=red;
  g.userData.solid=true; g.userData.rad=5.2; g.userData.top=3.2;
  return g;
}
export function buildTrek(){
  for(const s of Trek.saves){
    if(s.kind==='barn'){
      const b=buildBuilding('barn');
      b.position.set(s.x,s.y,s.z);
      b.rotation.y=Math.atan2(Trek.dest.x-s.x,Trek.dest.z-s.z);   // door toward the way on
      scene.add(b); buildings.push(b); s.objs.push(b);
      s.shelter={x:s.x,z:s.z,save:true}; shelters.push(s.shelter);
    }
    const col=beamColumn(SAVE_COL,140,1.6); col.position.set(s.x,s.y,s.z); scene.add(col); s.objs.push(col); s.beam=col;
    const gl=objectiveGlow(SAVE_COL,s.kind==='barn'?1.25:1.0); gl.position.set(s.x,s.y,s.z); scene.add(gl); s.objs.push(gl); s.glow=gl;
  }
  const d=Trek.dest;
  const bk=bunker(); bk.position.set(d.x,d.y,d.z);
  bk.rotation.y=Math.atan2(S.spawnX-d.x,S.spawnZ-d.z);            // door faces the way you came
  scene.add(bk); buildings.push(bk); d.objs.push(bk); d.bunker=bk;
  const col=beamColumn(DEST_COL,220,2.4); col.position.set(d.x,d.y,d.z); scene.add(col); d.objs.push(col); d.beam=col;
  const gl=objectiveGlow(DEST_COL,1.5); gl.position.set(d.x,d.y,d.z); scene.add(gl); d.objs.push(gl); d.glow=gl;
  // the door: where you have to get to
  const dr=new THREE.Object3D(); dr.position.set(0,0,4.6); bk.add(dr); d.door=dr;
  Trek.startT=S.elapsed;
}
export function clearTrek(){
  for(const s of Trek.saves)for(const o of s.objs){ scene.remove(o); const i=buildings.indexOf(o); if(i>=0)buildings.splice(i,1); }
  for(const s of Trek.saves){ if(s.shelter){ const i=shelters.indexOf(s.shelter); if(i>=0)shelters.splice(i,1); } }
  if(Trek.dest)for(const o of Trek.dest.objs){ scene.remove(o); const i=buildings.indexOf(o); if(i>=0)buildings.splice(i,1); }
  Trek.saves=[]; Trek.dest=null; Trek.last=-1;
  reserved.length=0; threats.pins.length=0;
}

/* ---- per frame ---- */
const _w=new THREE.Vector3();
export function nextSave(){ return Trek.saves.find(s=>!s.reached)||null; }
/* Is the wanderer, standing at P, properly sheltering in save point s? */
function inSave(s,P){
  if(s.kind==='barn')return P.inBarn===s.shelter;
  return P.cover==='bridge'&&Math.hypot(P.x-s.x,P.z-s.z)<16;
}
/* Returns 'won' when the escape door is reached, a save index when one is
   reached this frame, else null. */
export function updateTrek(dt,time,P){
  if(!Trek.dest)return null;
  let ev=null;
  for(let i=0;i<Trek.saves.length;i++){
    const s=Trek.saves[i];
    const d=Math.hypot(P.x-s.x,P.z-s.z);
    updateGlow(s.glow,time,s.reached?0.35:1);
    s.beam.material.opacity=(s.reached?0.06:0.16)*(d<30?d/30:1)+0.02;
    s.beam.material.color.setHex(s.reached?0x2a7a58:SAVE_COL);
    if(!s.reached&&inSave(s,P)){ s.reached=true; Trek.last=i; ev=i; }
    else if(s.reached&&inSave(s,P)&&Trek.last!==i){ Trek.last=i; }
  }
  const nx=nextSave();
  if(nx){ _w.set(nx.x,nx.y+3,nx.z); mark(_w,'#5cffa8',8); }
  const pins=threats.pins; pins.length=0;
  for(const s of Trek.saves)pins.push({x:s.x,z:s.z,col:s.reached?'#2a7a58':'#5cffa8',big:s===nx});
  pins.push({x:Trek.dest.x,z:Trek.dest.z,col:'#ffb040',big:true});
  const D=Trek.dest;
  _w.set(D.x,D.y+3,D.z); mark(_w,'#ffb040',8);
  updateGlow(D.glow,time,1);
  D.bunker.userData.blink.visible=Math.sin(time*3.2)>0;
  D.door.getWorldPosition(_w);
  if(Math.hypot(P.x-_w.x,P.z-_w.z)<3.2)ev='won';
  return ev;
}

/* Remaining distance along the way, for the HUD. */
export function trekDistances(P){
  const nx=nextSave();
  return {
    dest:Trek.dest?Math.hypot(P.x-Trek.dest.x,P.z-Trek.dest.z):0,
    save:nx?Math.hypot(P.x-nx.x,P.z-nx.z):null,
    saves:Trek.saves.filter(s=>s.reached).length, total:Trek.saves.length,
  };
}

/* Where a respawn puts you: the last save point, or the landing site. */
export function respawnSpot(){
  const s=Trek.saves[Trek.last];
  if(!s)return {x:S.spawnX,z:S.spawnZ,shelter:null};
  return {x:s.x,z:s.z,shelter:s.kind==='barn'?s.shelter:null};
}

export function saveReachedFX(i){
  const s=Trek.saves[i];
  banner(t('w.banner.save',{n:i+1,total:Trek.saves.length}));
  beep(523,0.14,0.06); setTimeout(()=>beep(659,0.14,0.06),140); setTimeout(()=>beep(784,0.22,0.06),280);
  return s;
}
