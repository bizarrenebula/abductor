/* =========================================================================
   ALIEN FAUNA — Moon (blob / crawler / skimmer) and Mars (strider / tumbler /
   wormling), built from primitives. Wormlings surface, sway, and burrow away.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE } from '../core/constants.js';
import { mat, part } from '../core/mesh.js';
import { World } from '../world/world-config.js';
import { heightAt } from '../world/terrain.js';

export const ALIEN_FAUNA={
  moon:{
    blob:{name:'Blob',pts:2,size:1.0},
    crawler:{name:'Crawler',pts:3,size:0.9},
    skimmer:{name:'Skimmer',pts:5,size:0.9}
  },
  mars:{
    strider:{name:'Strider',pts:3,size:1.0},
    tumbler:{name:'Tumbler',pts:5,size:0.9},
    wormling:{name:'Wormling',pts:4,size:1.0}
  }
};
export function buildAlien(form){
  const info=ALIEN_FAUNA[World.name][form];const s=info.size*OBJ_SCALE;const g=new THREE.Group();
  const u=g.userData;
  if(World.name==='moon'){
    const skin=0x8fa89a, glow=0x7fffd0;
    const eyeM=new THREE.MeshBasicMaterial({color:glow});
    if(form==='blob'){
      const b=part(new THREE.SphereGeometry(1,18,14),mat(skin,0.25),0,0.85,0);b.scale.set(1.25,0.9,1.25);g.add(b);
      g.add(part(new THREE.SphereGeometry(0.45,12,10),new THREE.MeshStandardMaterial({color:glow,emissive:glow,emissiveIntensity:0.7,roughness:0.4}),0,0.9,0));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,-0.3,1.2,0.95));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,0.3,1.2,0.95));
      g.add(part(new THREE.SphereGeometry(0.06,6,6),eyeM,0,1.45,0.9));
      u.pulse=1;u.hopDist=2;u.hopRng=1.5;u.hopDur=0.8;u.restMin=1.2;u.restRng=2;
    }else if(form==='crawler'){
      const b=part(new THREE.SphereGeometry(1,16,12),mat(skin,0.6),0,0.55,0);b.scale.set(1.1,0.5,1.5);g.add(b);
      const legM=mat(0x5a6e62,0.7);
      for(let i=0;i<3;i++){const z=-0.7+i*0.7;
        const l1=part(new THREE.CylinderGeometry(0.11,0.09,0.7,6),legM,-0.75,0.32,z);l1.rotation.z=0.7;g.add(l1);
        g.add(part(new THREE.SphereGeometry(0.11,7,6),legM,-1.05,0.1,z));   // rounded foot
        const l2=part(new THREE.CylinderGeometry(0.11,0.09,0.7,6),legM,0.75,0.32,z);l2.rotation.z=-0.7;g.add(l2);
        g.add(part(new THREE.SphereGeometry(0.11,7,6),legM,1.05,0.1,z));}
      const a1=part(new THREE.CylinderGeometry(0.07,0.05,0.8,6),legM,-0.2,1.05,0.9);a1.rotation.x=-0.7;g.add(a1);
      const a2=part(new THREE.CylinderGeometry(0.07,0.05,0.8,6),legM,0.2,1.05,0.9);a2.rotation.x=-0.7;g.add(a2);
      g.add(part(new THREE.SphereGeometry(0.08,7,6),eyeM,-0.22,0.75,1.35));
      g.add(part(new THREE.SphereGeometry(0.08,7,6),eyeM,0.22,0.75,1.35));
      u.hopDist=3.5;u.hopRng=2;u.hopDur=0.32;u.restMin=0.9;u.restRng=1.6;
    }else{
      const b=part(new THREE.SphereGeometry(1,16,12),mat(skin,0.35),0,0,0);b.scale.set(0.7,0.35,1.7);g.add(b);
      const fin=part(new THREE.ConeGeometry(0.5,0.9,4),mat(skin,0.5),0,0.5,-0.9);fin.rotation.x=-0.9;g.add(fin);
      const w1=part(new THREE.SphereGeometry(0.5,10,8),mat(skin,0.4),-0.9,0,0.1);w1.scale.set(1.4,0.12,0.8);g.add(w1);
      const w2=part(new THREE.SphereGeometry(0.5,10,8),mat(skin,0.4),0.9,0,0.1);w2.scale.set(1.4,0.12,0.8);g.add(w2);
      g.add(part(new THREE.SphereGeometry(0.16,8,8),new THREE.MeshBasicMaterial({color:glow}),0,-0.1,-1.6));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,-0.16,0.18,1.55));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,0.16,0.18,1.55));
      u.hover=2.6;u.hopDist=6;u.hopRng=4;u.hopDur=0.38;u.restMin=0.6;u.restRng=1.2;
    }
  }else{
    // mars fauna
    const skin=0x5a2a22, glow=0xff9060;
    const eyeM=new THREE.MeshBasicMaterial({color:glow});
    if(form==='strider'){
      // tripod walker: small hub on three long legs
      const legM=mat(0x3c1c16,0.8);
      for(let i=0;i<3;i++){
        const ang=i/3*Math.PI*2;
        const l=part(new THREE.CylinderGeometry(0.13,0.09,3.1,6),legM,Math.sin(ang)*0.9,1.5,Math.cos(ang)*0.9);
        l.rotation.z=Math.sin(ang)*0.32;l.rotation.x=-Math.cos(ang)*0.32;g.add(l);
        g.add(part(new THREE.SphereGeometry(0.13,7,6),legM,Math.sin(ang)*1.55,0.1,Math.cos(ang)*1.55));  // foot
        g.add(part(new THREE.SphereGeometry(0.16,8,7),legM,Math.sin(ang)*0.35,3.0,Math.cos(ang)*0.35));  // hip joint
      }
      const hub=part(new THREE.SphereGeometry(0.6,14,10),mat(skin,0.5),0,3.1,0);hub.scale.set(1.2,0.85,1.2);g.add(hub);
      g.add(part(new THREE.SphereGeometry(0.3,10,8),new THREE.MeshStandardMaterial({color:skin,emissive:glow,emissiveIntensity:0.35,roughness:0.5}),0,3.45,0.25));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,-0.16,3.5,0.5));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,0.16,3.5,0.5));
      u.hopDist=5;u.hopRng=2;u.hopDur=1.0;u.restMin=1.5;u.restRng=2;
    }else if(form==='tumbler'){
      // spiked tumbleweed that rolls in fast bursts
      const core=part(new THREE.DodecahedronGeometry(0.7,0),mat(0x7a4030,0.85),0,0.8,0);g.add(core);
      const spikeM=mat(0x8f5038,0.7);
      for(let i=0;i<8;i++){
        const th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI;
        const sp=part(new THREE.ConeGeometry(0.14,0.6,5),spikeM,
          Math.sin(ph)*Math.cos(th)*0.7,0.8+Math.cos(ph)*0.7,Math.sin(ph)*Math.sin(th)*0.7);
        sp.lookAt(sp.position.x*2,(sp.position.y-0.8)*2+0.8,sp.position.z*2);
        sp.rotateX(Math.PI/2);g.add(sp);
      }
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,-0.2,0.85,0.68));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,0.2,0.85,0.68));
      u.roll=1;u.hopDist=7;u.hopRng=4;u.hopDur=0.4;u.restMin=0.4;u.restRng=1.2;
    }else{
      // wormling: surfaces, sways, burrows away
      const segM=mat(0x6e3226,0.6);
      const ys=[0.5,1.05,1.05,0.5],rs=[0.45,0.42,0.36,0.3];
      for(let i=0;i<4;i++){
        g.add(part(new THREE.SphereGeometry(rs[i],12,10),segM,0,ys[i],-1.1+i*0.75));
      }
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,-0.14,0.72,1.35));
      g.add(part(new THREE.SphereGeometry(0.07,6,6),eyeM,0.14,0.72,1.35));
      u.wormKind=1;u.surfT=5+Math.random()*4;
    }
  }
  g.scale.setScalar(s);
  u.biome=World.name;u.name=info.name;u.pts=info.pts;u.baseS=s;
  u.hopTimer=1+Math.random()*2;u.hop=null;u.progress=0;u.abducting=0;u.face=Math.random()*6.28;
  return g;
}
export function updateWorm(a,u,dt){
  const g=heightAt(a.position.x,a.position.z);
  if(u.hidden>0){
    u.hidden-=dt;
    a.position.y=g-4;
    if(u.hidden<=0){
      a.position.x+=(Math.random()-0.5)*12;
      a.position.z+=(Math.random()-0.5)*12;
      a.visible=true;u.surfT=5+Math.random()*4;u.progress=0;
    }
    return;
  }
  u.surfT-=dt;
  a.position.y=g+Math.sin(performance.now()*0.004+u.face)*0.15;
  a.rotation.y+=dt*0.3;
  if(u.surfT<=0){u.hidden=3.5+Math.random()*3;a.visible=false;u.progress=0;}
}
