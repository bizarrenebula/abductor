/* =========================================================================
   HUMANS + BUILDINGS — villagers/hikers who notice the ship, flee to the
   nearest shelter, and hide; plus the barns and camps they run toward.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, COLLECT_SCALE, ASSETS } from '../core/constants.js';
import { mat, part, glowMat, measureSolid } from '../core/mesh.js';
import { S } from '../core/state.js';
import { heightAt } from '../world/terrain.js';
import { LOADED, spawnModel } from '../assets.js';
import { shelters, buildings } from './registry.js';
import { saucer } from '../systems/saucer.js';

/* Warm window helper — a glowing amber pane that reads as an inhabited building
   from across the valley (art brief). */
function litWindow(w,h,x,y,z,ry){
  const win=glowMat(0xffb24a,1.8);
  const p=part(new THREE.PlaneGeometry(w,h),win,x,y,z);
  if(ry)p.rotation.y=ry; p.castShadow=false; return p;
}

/* ---------- buildings: shelters for fleeing humans ----------
   Chunky, simple, silhouette-first rural structures — barn, house, water tower,
   windmill (slowly turning), and a desert camp — per the art brief. */

/* Village palette — saturated wall/roof pairs so houses read as a colourful
   settlement from the air instead of a row of brown boxes. One pair is picked
   per building at build time. */
const HOUSE_COLS=[
  {wall:0xd94f3d,roof:0x5c1f18},   // barn red
  {wall:0xe8c15a,roof:0x6b4a1c},   // ochre
  {wall:0x4fa3d9,roof:0x1d3f63},   // sky blue
  {wall:0x63b85a,roof:0x25502a},   // meadow green
  {wall:0xe6e0d2,roof:0x8a3b2c},   // whitewash + terracotta
  {wall:0xb05fc0,roof:0x3d1f4a},   // plum
  {wall:0xe89a4a,roof:0x6b3318},   // pumpkin
];
export const HOUSE_COL_COUNT=HOUSE_COLS.length;
const pickHouse=()=>HOUSE_COLS[(Math.random()*HOUSE_COLS.length)|0];

/* `colIdx` pins the wall/roof pair instead of rolling for it, so a caller that
   needs the same building to come back the same way after a chunk reload (see
   world/settlements.js) can key it off its own hash. */
export function buildBuilding(kind,colIdx){
  if(kind==='barn'&&LOADED.barn){
    const g=spawnModel('barn');
    g.scale.setScalar((ASSETS.barn.scale||1)*OBJ_SCALE);
    g.userData.solid=true;measureSolid(g);   // barns are solid: the ship crashes into them
    return g;
  }
  const g=new THREE.Group();
  const hc=colIdx==null?pickHouse():HOUSE_COLS[((colIdx%HOUSE_COLS.length)+HOUSE_COLS.length)%HOUSE_COLS.length];
  if(kind==='barn'){
    g.add(part(new THREE.BoxGeometry(4.2,2.4,3.2),mat(hc.wall,0.9),0,1.2,0));
    const roof=part(new THREE.CylinderGeometry(0,2.6,1.7,4),mat(hc.roof,0.9),0,3.2,0);
    roof.rotation.y=Math.PI/4;roof.scale.set(1.25,1,0.95);g.add(roof);
    g.add(litWindow(0.72,0.72,-1.05,1.45,1.61));g.add(litWindow(0.72,0.72,1.05,1.45,1.61));
    g.add(litWindow(0.72,0.72,2.11,1.45,0,Math.PI/2));
    g.add(part(new THREE.BoxGeometry(1.1,1.6,0.1),mat(0x14100c,0.9),0,0.8,1.62));
    g.scale.multiplyScalar(OBJ_SCALE);
  }else if(kind==='house'){
    g.add(part(new THREE.BoxGeometry(3.4,2.0,2.8),mat(hc.wall,0.9),0,1.0,0));          // walls
    const roof=part(new THREE.CylinderGeometry(0,2.3,1.35,4),mat(hc.roof,0.9),0,2.68,0);
    roof.rotation.y=Math.PI/4;roof.scale.set(1.3,1,1.05);g.add(roof);                    // pitched roof
    g.add(litWindow(0.6,0.6,-0.72,1.05,1.42));g.add(litWindow(0.6,0.6,0.72,1.05,1.42));
    g.add(part(new THREE.BoxGeometry(0.42,1.0,0.42),mat(0x1a120c,0.9),1.0,3.0,-0.5));    // chimney
    g.scale.multiplyScalar(OBJ_SCALE);
  }else if(kind==='watertower'){
    const legMat=mat(0x2c2622,0.9);
    for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2, lx=Math.cos(a)*1.05, lz=Math.sin(a)*1.05;
      const leg=part(new THREE.CylinderGeometry(0.09,0.12,4.4,5),legMat,lx,2.2,lz);
      leg.rotation.set(-lz*0.09,0,lx*0.09);g.add(leg);}
    g.add(part(new THREE.CylinderGeometry(1.5,1.5,1.9,10),mat(hc.wall,0.9),0,5.1,0));   // tank
    g.add(part(new THREE.ConeGeometry(1.62,0.85,10),mat(hc.roof,0.9),0,6.4,0));         // conic roof
    g.scale.multiplyScalar(OBJ_SCALE);
  }else if(kind==='windmill'){
    const wm=mat(0x39332c,0.9);
    for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2, lx=Math.cos(a)*0.7, lz=Math.sin(a)*0.7;
      const leg=part(new THREE.CylinderGeometry(0.05,0.09,4.7,4),wm,lx,2.35,lz);
      leg.rotation.set(-lz*0.15,0,lx*0.15);g.add(leg);}
    g.add(part(new THREE.BoxGeometry(0.9,0.35,0.9),wm,0,4.75,0));                        // deck
    const hub=new THREE.Group();hub.position.set(0,4.95,0.35);                           // fan faces +z
    hub.add(part(new THREE.CylinderGeometry(0.13,0.13,0.26,8),mat(0x1c1814,0.8),0,0,0.05));
    const bladeMat=mat(0xb6bcc2,0.7);
    for(let i=0;i<10;i++){const a=i/10*Math.PI*2;
      const bl=part(new THREE.BoxGeometry(0.05,1.15,0.32),bladeMat,Math.cos(a)*0.72,Math.sin(a)*0.72,0.12);
      bl.rotation.z=a;hub.add(bl);}
    g.add(hub);g.userData.spinner=hub;                                                   // rotated by updateWindmills
    g.scale.multiplyScalar(OBJ_SCALE);
  }else{
    // camp: tent + dying fire
    const tent=part(new THREE.CylinderGeometry(0,1.7,2.0,4),mat(hc.wall,0.95),0,1.0,0);
    tent.rotation.y=Math.PI/4;g.add(tent);
    g.add(part(new THREE.SphereGeometry(0.2,8,6),new THREE.MeshStandardMaterial({color:0x662200,emissive:0xff6820,emissiveIntensity:0.9,roughness:0.6}),1.8,0.15,0.6));
    g.add(part(new THREE.CylinderGeometry(0.07,0.07,0.9,5),mat(0x2c1e12,0.95),2.1,0.1,0.3));g.scale.multiplyScalar(OBJ_SCALE);
  }
  // Everything but the low canvas camp is solid: the ship crashes into it.
  if(kind!=='camp'){g.userData.solid=true;measureSolid(g);}
  return g;
}

/* Slowly turn every windmill's fan — "everything should move slowly" (brief). */
export function updateWindmills(dt){
  for(const b of buildings){ const s=b.userData&&b.userData.spinner; if(s)s.rotation.z+=dt*0.55; }
}

/* ---------- humans: they notice you, run, and hide ---------- */
export function buildHuman(kind){
  const villager=kind==='villager';
  if(!villager&&LOADED.hiker){
    const g=spawnModel('hiker');
    g.scale.setScalar((ASSETS.hiker.scale||1)*0.9*OBJ_SCALE*COLLECT_SCALE);
    const u=g.userData;
    u.humanKind=kind;u.name='Hiker';u.pts=8;
    u.speed=6.8+Math.random()*1.4;u.fleeT=0;u.hidden=0;
    u.biome='plains';u.baseS=(ASSETS.hiker.scale||1)*0.9*OBJ_SCALE*COLLECT_SCALE;
    u.hopTimer=99;u.hop=null;u.progress=0;u.abducting=0;u.face=Math.random()*6.28;
    return g;
  }
  const g=new THREE.Group();
  const cloth=mat(villager?0x8f5fd0:0xd98a2b,0.9),skin=mat(0xe8bb95,0.8);
  g.add(part(new THREE.CylinderGeometry(0.15,0.18,0.75,8),mat(0x26242c,0.9),0,0.38,0));
  g.add(part(new THREE.CylinderGeometry(0.2,0.24,0.7,8),cloth,0,1.0,0));
  g.add(part(new THREE.SphereGeometry(0.22,10,8),skin,0,1.58,0));
  if(!villager)g.add(part(new THREE.BoxGeometry(0.36,0.5,0.22),mat(0x8a3a20,0.85),0,1.05,-0.3));
  g.scale.setScalar(0.9*OBJ_SCALE*COLLECT_SCALE);
  const u=g.userData;
  u.humanKind=kind;u.name=villager?'Villager':'Hiker';u.pts=villager?10:8;
  u.speed=6.8+Math.random()*1.4;u.fleeT=0;u.hidden=0;
  u.biome='plains';u.baseS=0.9*OBJ_SCALE;u.hopTimer=99;u.hop=null;u.progress=0;u.abducting=0;u.face=Math.random()*6.28;
  return g;
}
export function updateHuman(a,u,dt){
  if(u.hidden>0){
    u.hidden-=dt;
    if(u.hidden<=0){a.visible=true;u.fleeT=0;u.progress=0;}
    return;
  }
  const dx=a.position.x-saucer.position.x,dz=a.position.z-saucer.position.z;
  const d=Math.hypot(dx,dz)||0.001;
  const night=S.dayF<0.5;
  // Cloaked = fully invisible: humans never notice the ship and go on with their
  // idle. Only a decloaked ship (cloak drops the instant the beam opens) is seen.
  const notice = S.cloak ? false
    : night ? (S.beamPower>0.4 && d<40)     // night: only the active beam gives you away
    : (d<34 || (S.beamPower>0.4 && d<55));  // day: they spot the ship itself
  if(notice)u.fleeT=1.8;
  if(u.fleeT>0){
    u.fleeT-=dt;
    let tx=a.position.x+dx/d*12, tz=a.position.z+dz/d*12;   // default: away
    let best=null,bd=70;
    // Forecourt NPCs panic and scatter instead of filing into a shelter: each
    // keeps a fixed random deflection so a group bursts apart rather than
    // running as one column. u.bolt is re-rolled each time panic starts.
    if(u.scatter){
      if(u.bolt==null)u.bolt=(Math.random()*2-1)*1.5;
      const ang=Math.atan2(dx,dz)+u.bolt;
      tx=a.position.x+Math.sin(ang)*14; tz=a.position.z+Math.cos(ang)*14;
    }else{
      for(const s of shelters){
        const sx=s.x-a.position.x,sz2=s.z-a.position.z;
        const sd=Math.hypot(sx,sz2);
        if(sd<bd){bd=sd;best=s;}
      }
      if(best){tx=best.x;tz=best.z;}
    }
    const mx=tx-a.position.x,mz=tz-a.position.z,ml=Math.hypot(mx,mz)||1;
    a.position.x+=mx/ml*u.speed*dt;
    a.position.z+=mz/ml*u.speed*dt;
    a.position.y=heightAt(a.position.x,a.position.z)+Math.abs(Math.sin(performance.now()*0.018))*0.14;
    a.rotation.y=Math.atan2(mx,mz);
    if(best&&bd<2.4){u.hidden=7+Math.random()*4;a.visible=false;u.progress=0;}
  }else{
    u.bolt=null;                                                     // re-roll next panic
    a.position.y=heightAt(a.position.x,a.position.z);
    a.rotation.y+=Math.sin(performance.now()*0.0005+u.face)*0.004;   // idle
  }
}
