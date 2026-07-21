/* =========================================================================
   HUMANS + BUILDINGS — villagers/hikers who notice the ship, flee to the
   nearest shelter, and hide; plus the barns and camps they run toward.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, ASSETS } from '../core/constants.js';
import { mat, part } from '../core/mesh.js';
import { S } from '../core/state.js';
import { heightAt } from '../world/terrain.js';
import { LOADED, spawnModel } from '../assets.js';
import { shelters } from './registry.js';
import { saucer } from '../systems/saucer.js';

/* ---------- buildings: shelters for fleeing humans ---------- */
export function buildBuilding(kind){
  if(kind==='barn'&&LOADED.barn){
    const g=spawnModel('barn');
    g.scale.setScalar((ASSETS.barn.scale||1)*OBJ_SCALE);
    return g;
  }
  const g=new THREE.Group();
  if(kind==='barn'){
    g.add(part(new THREE.BoxGeometry(4.2,2.4,3.2),mat(0x3a2420,0.9),0,1.2,0));
    const roof=part(new THREE.CylinderGeometry(0,2.6,1.7,4),mat(0x241610,0.9),0,3.2,0);
    roof.rotation.y=Math.PI/4;roof.scale.set(1.25,1,0.95);g.add(roof);
    g.add(part(new THREE.BoxGeometry(1.1,1.6,0.1),mat(0x14100c,0.9),0,0.8,1.62));
    g.add(part(new THREE.SphereGeometry(0.08,6,6),new THREE.MeshBasicMaterial({color:0xd8b46a}),0.9,1.7,1.62));
    g.scale.multiplyScalar(OBJ_SCALE);
  }else{
    // camp: tent + dying fire
    const tent=part(new THREE.CylinderGeometry(0,1.7,2.0,4),mat(0x44403a,0.95),0,1.0,0);
    tent.rotation.y=Math.PI/4;g.add(tent);
    g.add(part(new THREE.SphereGeometry(0.2,8,6),new THREE.MeshStandardMaterial({color:0x662200,emissive:0xff6820,emissiveIntensity:0.9,roughness:0.6}),1.8,0.15,0.6));
    g.add(part(new THREE.CylinderGeometry(0.07,0.07,0.9,5),mat(0x2c1e12,0.95),2.1,0.1,0.3));g.scale.multiplyScalar(OBJ_SCALE);
  }
  return g;
}

/* ---------- humans: they notice you, run, and hide ---------- */
export function buildHuman(kind){
  const villager=kind==='villager';
  if(!villager&&LOADED.hiker){
    const g=spawnModel('hiker');
    g.scale.setScalar((ASSETS.hiker.scale||1)*0.9*OBJ_SCALE);
    const u=g.userData;
    u.humanKind=kind;u.name='Hiker';u.pts=8;
    u.speed=6.8+Math.random()*1.4;u.fleeT=0;u.hidden=0;
    u.biome='plains';u.baseS=(ASSETS.hiker.scale||1)*0.9*OBJ_SCALE;
    u.hopTimer=99;u.hop=null;u.progress=0;u.abducting=0;u.face=Math.random()*6.28;
    return g;
  }
  const g=new THREE.Group();
  const cloth=mat(villager?0x4a3a50:0x6e4a20,0.9),skin=mat(0xc9a184,0.8);
  g.add(part(new THREE.CylinderGeometry(0.15,0.18,0.75,8),mat(0x26242c,0.9),0,0.38,0));
  g.add(part(new THREE.CylinderGeometry(0.2,0.24,0.7,8),cloth,0,1.0,0));
  g.add(part(new THREE.SphereGeometry(0.22,10,8),skin,0,1.58,0));
  if(!villager)g.add(part(new THREE.BoxGeometry(0.36,0.5,0.22),mat(0x8a3a20,0.85),0,1.05,-0.3));
  g.scale.setScalar(0.9*OBJ_SCALE);
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
  const cloaked=S.cloak;
  const notice = (night||cloaked)
    ? (S.beamPower>0.4 && d<40)            // night OR cloaked: only the active beam gives you away
    : (d<34 || (S.beamPower>0.4 && d<55)); // day, uncloaked: they spot the ship itself
  if(notice)u.fleeT=1.8;
  if(u.fleeT>0){
    u.fleeT-=dt;
    let tx=a.position.x+dx/d*12, tz=a.position.z+dz/d*12;   // default: away
    let best=null,bd=70;
    for(const s of shelters){
      const sx=s.x-a.position.x,sz2=s.z-a.position.z;
      const sd=Math.hypot(sx,sz2);
      if(sd<bd){bd=sd;best=s;}
    }
    if(best){tx=best.x;tz=best.z;}
    const mx=tx-a.position.x,mz=tz-a.position.z,ml=Math.hypot(mx,mz)||1;
    a.position.x+=mx/ml*u.speed*dt;
    a.position.z+=mz/ml*u.speed*dt;
    a.position.y=heightAt(a.position.x,a.position.z)+Math.abs(Math.sin(performance.now()*0.018))*0.14;
    a.rotation.y=Math.atan2(mx,mz);
    if(best&&bd<2.4){u.hidden=7+Math.random()*4;a.visible=false;u.progress=0;}
  }else{
    a.position.y=heightAt(a.position.x,a.position.z);
    a.rotation.y+=Math.sin(performance.now()*0.0005+u.face)*0.004;   // idle
  }
}
