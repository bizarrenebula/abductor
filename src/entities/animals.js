/* =========================================================================
   EARTH ANIMALS — sheep / camel / goat / duck (custom model when loaded, else
   procedural), plus the shared per-frame hop/idle updater that also dispatches
   humans and wormlings to their own updaters.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, WATER_Y } from '../core/constants.js';
import { lerp } from '../core/math.js';
import { mat, part } from '../core/mesh.js';
import { S } from '../core/state.js';
import { heightAt } from '../world/terrain.js';
import { LOADED, spawnModel } from '../assets.js';
import { animals } from './registry.js';
import { updateHuman } from './humans.js';
import { updateWorm } from './aliens.js';

export const ANIMALS={
  desert :{name:'Camel', pts:3, size:1.3},
  plains :{name:'Sheep', pts:1, size:1.1},
  mountain:{name:'Goat', pts:4, size:0.95},
  water  :{name:'Duck',  pts:2, size:0.7}
};
export function buildAnimal(biome){
  const info=ANIMALS[biome];const s=info.size*OBJ_SCALE;
  // --- custom model path ---
  const modelName=(biome==='plains')?'sheep':(biome==='water')?'duck':(biome==='desert')?'camel':(biome==='mountain')?'goat':null;
  if(modelName&&LOADED[modelName]){
    const g=spawnModel(modelName);
    g.scale.setScalar(s);
    g.userData.legY=0;g.userData.biome=biome;g.userData.name=info.name;
    g.userData.hopTimer=1+Math.random()*2.5;
    g.userData.hop=null;g.userData.progress=0;g.userData.abducting=0;g.userData.face=Math.random()*6.28;
    g.userData.pts=info.pts;g.userData.baseS=s;
    return g;
  }
  const g=new THREE.Group();
  const eyeM=new THREE.MeshBasicMaterial({color:0xd8efe0});
  const eyes=(x,y,z,r)=>{g.add(part(new THREE.SphereGeometry(r,6,6),eyeM,-x,y,z));
    g.add(part(new THREE.SphereGeometry(r,6,6),eyeM,x,y,z));};
  if(biome==='water'){
    const bodyM=mat(0x5b4a33,0.7);
    const b=part(new THREE.SphereGeometry(1,16,12),bodyM,0,0.7,0);b.scale.set(1.35,0.85,1.05);g.add(b);
    const tail=part(new THREE.ConeGeometry(0.35,0.7,10),bodyM,0,0.85,-1.15);tail.rotation.x=-1.4;g.add(tail);
    g.add(part(new THREE.CylinderGeometry(0.26,0.34,0.5,10),mat(0xe6e6e0,0.6),0,1.12,0.7));
    g.add(part(new THREE.SphereGeometry(0.5,16,12),mat(0x1c5a3c,0.35),0,1.5,0.85));
    eyes(0.2,1.6,1.2,0.07);
    const bill=part(new THREE.ConeGeometry(0.2,0.55,10),mat(0xe8a13a,0.5),0,1.5,1.35);bill.rotation.x=Math.PI/2;g.add(bill);
  }else if(biome==='plains'){
    // sheep: woolly pale body, dark slim legs and head
    const wool=mat(0xd8d4c6,0.98), dark=mat(0x26221e,0.9);
    const b=part(new THREE.SphereGeometry(1,16,12),wool,0,1.15,0);b.scale.set(1.4,1.0,0.95);g.add(b);
    g.add(part(new THREE.SphereGeometry(0.5,10,8),wool,-0.45,1.7,0.2));
    g.add(part(new THREE.SphereGeometry(0.45,10,8),wool,0.4,1.65,-0.4));
    g.add(part(new THREE.SphereGeometry(0.42,10,8),wool,0.1,1.75,0.55));
    g.add(part(new THREE.SphereGeometry(0.4,14,12),dark,0,1.35,1.35));
    const e1=part(new THREE.SphereGeometry(0.14,8,6),dark,-0.35,1.55,1.3);e1.scale.set(1,0.5,0.7);g.add(e1);
    const e2=part(new THREE.SphereGeometry(0.14,8,6),dark,0.35,1.55,1.3);e2.scale.set(1,0.5,0.7);g.add(e2);
    [[-0.55,0.75],[0.55,0.75],[-0.55,-0.7],[0.55,-0.7]].forEach(p=>g.add(part(new THREE.CylinderGeometry(0.11,0.09,1.0,8),dark,p[0],0.5,p[1])));
    eyes(0.16,1.45,1.68,0.07);
  }else if(biome==='desert'){
    // camel: chunky rounded forms — reads cleanly even at reduced segments
    const hide=mat(0xb99a62,0.9);
    const b=part(new THREE.SphereGeometry(1,16,12),hide,0,1.7,0);b.scale.set(1.5,0.9,0.82);g.add(b);
    // two humps as fuller spheres, nestled together
    const hp1=part(new THREE.SphereGeometry(0.6,12,10),hide,0,2.35,0.3);hp1.scale.set(0.9,1.0,0.9);g.add(hp1);
    const hp2=part(new THREE.SphereGeometry(0.56,12,10),hide,0,2.3,-0.55);hp2.scale.set(0.9,1.0,0.9);g.add(hp2);
    // neck as a tapered chunky form + rounded head
    const neck=part(new THREE.CylinderGeometry(0.28,0.36,1.4,10),hide,0,2.3,1.05);neck.rotation.x=0.5;g.add(neck);
    const head=part(new THREE.SphereGeometry(0.42,12,10),hide,0,2.95,1.5);head.scale.set(0.9,0.85,1.25);g.add(head);
    const snout=part(new THREE.SphereGeometry(0.24,10,8),hide,0,2.82,1.9);snout.scale.set(0.8,0.7,1.1);g.add(snout);
    // sturdier tapered legs (thicker, so they don't look like sticks when simplified)
    [[-0.5,0.7],[0.5,0.7],[-0.5,-0.6],[0.5,-0.6]].forEach(p=>{
      const leg=part(new THREE.CylinderGeometry(0.16,0.13,1.75,8),hide,p[0],0.88,p[1]);g.add(leg);
      g.add(part(new THREE.SphereGeometry(0.15,8,7),hide,p[0],0.05,p[1]));   // rounded hoof
    });
    eyes(0.19,3.02,1.72,0.08);
  }else{
    // mountain goat: compact, sturdy — chunky legs, bolder horns, clear beard
    const hide=mat(0xbdb6a8,0.95), horn=mat(0x4a4238,0.6);
    const b=part(new THREE.SphereGeometry(1,16,12),hide,0,1.05,0);b.scale.set(1.35,0.95,0.88);g.add(b);
    const head=part(new THREE.SphereGeometry(0.5,14,12),hide,0,1.5,1.15);head.scale.set(0.95,0.95,1.05);g.add(head);
    const snout=part(new THREE.SphereGeometry(0.26,10,8),hide,0,1.4,1.55);snout.scale.set(0.85,0.8,1.05);g.add(snout);
    // horns: bolder, curved back via two-segment cones
    const h1=part(new THREE.ConeGeometry(0.15,0.9,8),horn,-0.24,1.9,0.85);h1.rotation.x=-2.2;g.add(h1);
    const h2=part(new THREE.ConeGeometry(0.15,0.9,8),horn,0.24,1.9,0.85);h2.rotation.x=-2.2;g.add(h2);
    // ears
    g.add(part(new THREE.SphereGeometry(0.13,8,6),hide,-0.4,1.62,1.0));
    g.add(part(new THREE.SphereGeometry(0.13,8,6),hide,0.4,1.62,1.0));
    const beard=part(new THREE.ConeGeometry(0.14,0.42,7),hide,0,1.05,1.4);beard.rotation.x=Math.PI;g.add(beard);
    // chunky legs with hooves
    [[-0.55,0.72],[0.55,0.72],[-0.55,-0.62],[0.55,-0.62]].forEach(p=>{
      g.add(part(new THREE.CylinderGeometry(0.15,0.12,1.0,8),hide,p[0],0.5,p[1]));
      g.add(part(new THREE.SphereGeometry(0.13,8,7),hide,p[0],0.02,p[1]));
    });
    eyes(0.22,1.6,1.5,0.08);
  }
  g.userData.legY=0;
  g.scale.setScalar(s);
  g.userData.biome=biome;g.userData.name=info.name;
  g.userData.hopTimer=1+Math.random()*2.5;
  g.userData.hop=null; g.userData.progress=0; g.userData.abducting=0; g.userData.face=Math.random()*6.28;
  g.userData.pts=info.pts; g.userData.baseS=s;
  return g;
}

/* ---------- animal hop / idle update (also dispatches humans + worms) ---------- */
export function updateAnimals(dt){
  for(const a of animals){
    if(a.userData.abducting>0) continue;
    const u=a.userData;
    if(u.humanKind){updateHuman(a,u,dt);continue;}
    if(u.wormKind){updateWorm(a,u,dt);continue;}
    if(u.hop){
      u.hop.t+=dt/u.hop.dur;
      const t=Math.min(1,u.hop.t);
      const x=lerp(u.hop.fx,u.hop.tx,t), z=lerp(u.hop.fz,u.hop.tz,t);
      const ground=(u.biome==='water'?WATER_Y+0.1:heightAt(x,z))+(u.hover||0);
      a.position.set(x,ground+Math.sin(Math.PI*t)*0.5,z);
      // face travel dir
      a.rotation.y=lerp(a.rotation.y,u.hop.face,Math.min(1,dt*8));
      if(u.roll)a.rotation.x+=dt*16;
      if(t>=1){u.hop=null;const rf=(S?(1.6-0.7*S.dayF):1);u.hopTimer=((u.restMin||1.4)+Math.random()*(u.restRng||2.6))*rf;}
    }else{
      u.hopTimer-=dt;
      // gentle idle bob
      if(u.biome==='water'){
        const tt=performance.now()*0.001;
        a.position.y=WATER_Y+0.15+Math.sin(a.position.x*0.15+tt*1.1)*0.22+Math.cos(a.position.z*0.19+tt*1.4)*0.18;
        a.rotation.y+=Math.sin(tt*0.7+u.face)*0.003;
      }else{
        const g=heightAt(a.position.x,a.position.z)+(u.hover||0);
        a.position.y=g+Math.sin(performance.now()*0.003+u.face)*(u.hover?0.3:0.05);
      }
      if(u.pulse)a.scale.setScalar(u.baseS*(1+0.07*Math.sin(performance.now()*0.003+u.face)));
      if(u.hopTimer<=0){
        const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
        const d=dirs[(Math.random()*4)|0];
        const dspd=0.7+0.55*(S?S.dayF:1);   // day faster, night slower
        const dist=(u.hopDist||3)+Math.random()*(u.hopRng||2.5);
        u.hop={fx:a.position.x,fz:a.position.z,tx:a.position.x+d[0]*dist,tz:a.position.z+d[1]*dist,
          t:0,dur:(u.hopDur||0.55)/dspd,face:Math.atan2(d[0],d[1])};
      }
    }
  }
}
