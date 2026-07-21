/* =========================================================================
   CRYSTALS — energy pickups. Semi-buried; lift and vanish when held in the
   beam, refuelling the reactor and pinging story/mission hooks.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, ASSETS } from '../core/constants.js';
import { part } from '../core/mesh.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { World } from '../world/world-config.js';
import { LOADED, spawnModel } from '../assets.js';
import { pickups } from './registry.js';
import { chunks } from '../world/chunks.js';
import { saucer } from '../systems/saucer.js';
import { effBeamR } from '../systems/beam.js';
import { checkMissions } from '../systems/missions.js';
import { beep } from '../audio/music.js';
import { spawnPop } from '../ui/pop.js';
import { Story } from '../story/story.js';

export function buildCrystal(){
  const tint=World.name==='moon'?0x9fe8ff:World.name==='mars'?0xff7a50:0x8fe8b8;
  // --- custom model path ---
  if(LOADED.crystal){
    const g=spawnModel('crystal');
    const mats=[];
    g.traverse(o=>{ if(o.isMesh&&o.material){
      o.material=o.material.clone();           // unique per instance so the pulse is independent
      o.material.emissive=new THREE.Color(tint);
      o.material.emissiveIntensity=0.7;
      mats.push(o.material);
    }});
    g.rotation.y=Math.random()*6.28;
    g.userData.lift=0;g.userData.phase=Math.random()*6.28;
    g.userData.mats=mats;g.userData.s0=(ASSETS.crystal.scale||1)*OBJ_SCALE;
    g.scale.setScalar(g.userData.s0);
    return g;
  }
  const g=new THREE.Group();
  const m=new THREE.MeshStandardMaterial({color:tint,emissive:tint,emissiveIntensity:0.7,
    roughness:0.15,metalness:0.1,transparent:true,opacity:0.94});
  const n=1+((Math.random()*3)|0);
  for(let i=0;i<n;i++){
    const c=part(new THREE.OctahedronGeometry(0.45+Math.random()*0.5,0),m,
      (Math.random()-0.5)*1.6,0.35+Math.random()*0.3,(Math.random()-0.5)*1.6);
    c.scale.y=1.7+Math.random();
    c.rotation.set((Math.random()-0.5)*0.9,Math.random()*3,(Math.random()-0.5)*0.9);
    g.add(c);
  }
  g.userData.lift=0;g.userData.phase=Math.random()*6.28;g.userData.mats=[m];g.userData.s0=OBJ_SCALE;g.scale.setScalar(OBJ_SCALE);
  return g;
}
export function updateCrystals(dt,beamActive){
  const t=performance.now()*0.001,R=effBeamR();
  for(let i=pickups.length-1;i>=0;i--){
    const p=pickups[i],u=p.userData;
    const eI=0.55+0.3*Math.sin(t*1.6+u.phase);(u.mats||[]).forEach(m=>m.emissiveIntensity=eI);   // soft breathing glow
    const dx=p.position.x-saucer.position.x,dz=p.position.z-saucer.position.z;
    const inBeam=beamActive&&(dx*dx+dz*dz)<R*R;
    if(inBeam){u.lift=Math.min(1,u.lift+dt/0.9);p.rotation.y+=dt*6;}
    else if(u.lift>0)u.lift=Math.max(0,u.lift-dt*1.6);          // dropped back
    p.position.y=u.baseY+u.lift*(saucer.position.y-2-u.baseY);
    const sc=(1-u.lift*0.55)*(u.s0||1);p.scale.setScalar(Math.max(0.05,sc));
    if(u.lift>=1){
      S.energy=Math.min(1,S.energy+0.35);
      S.crystals++;
      Story.crystalHook();
      spawnPop(p.position,'+⚡','CRYSTAL');
      beep(523,0.12,0.08);setTimeout(()=>beep(784,0.16,0.08),70);
      scene.remove(p);pickups.splice(i,1);
      for(const [k,c] of chunks){const j=c.pickups.indexOf(p);if(j>=0){c.pickups.splice(j,1);break;}}
      checkMissions();
    }
  }
}
