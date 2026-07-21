/* =========================================================================
   MOON DUST GEYSERS — telegraphed ground eruptions. A warning ring shrinks,
   then the column blasts up; being caught in the blast (uncloaked) is fatal.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { World } from '../world/world-config.js';
import { heightAt } from '../world/terrain.js';
import { saucer } from '../systems/saucer.js';
import { beep } from '../audio/music.js';
import { sfxGeyserWarn, sfxGeyserErupt, BeamSFX } from '../audio/sfx.js';
import { banner } from '../ui/banner.js';
import { hazMult, hazCount } from './common.js';
import { t as tr } from '../i18n.js';   // aliased: `t` is used locally for time in updateGeysers

const LOW_END = env.LOW_END;

const geysers=[];
let geyserTimer=7;
function makeGeyserRing(){
  const ring=new THREE.Mesh(new THREE.RingGeometry(0.86,1,40),
    new THREE.MeshBasicMaterial({color:0xbfe0ff,transparent:true,opacity:0.6,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;return ring;
}
function makeGeyserVent(){
  // a small raised rocky rim of regolith around the fissure — the physical geyser object
  const g=new THREE.Group();
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(2.4,3.0,0.9,12,1,true),
    new THREE.MeshStandardMaterial({color:0x6a6f78,roughness:1,metalness:0,flatShading:true,side:THREE.DoubleSide}));
  rim.position.y=0.35;g.add(rim);
  // clustered rocks on the rim
  for(let i=0;i<7;i++){
    const a=i/7*Math.PI*2;
    const r=new THREE.Mesh(new THREE.DodecahedronGeometry(0.35+Math.random()*0.35,0),
      new THREE.MeshStandardMaterial({color:0x585d66,roughness:1,flatShading:true}));
    r.position.set(Math.cos(a)*2.7,0.5+Math.random()*0.2,Math.sin(a)*2.7);
    r.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);g.add(r);
  }
  // dark bore in the middle
  const bore=new THREE.Mesh(new THREE.CircleGeometry(1.8,16),
    new THREE.MeshBasicMaterial({color:0x0a0d10}));
  bore.rotation.x=-Math.PI/2;bore.position.y=0.05;g.add(bore);
  return g;
}
function makeGeyserPlume(){
  // multi-part eruption: a fast core jet, billowing outer dust, a spreading cap, and debris chunks
  const g=new THREE.Group();
  const core=new THREE.Mesh(new THREE.CylinderGeometry(0.8,1.6,30,12,1,true),
    new THREE.MeshBasicMaterial({color:0xeaf3fb,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));
  core.position.y=15;g.add(core);
  const outer=new THREE.Mesh(new THREE.CylinderGeometry(2.0,3.6,26,14,1,true),
    new THREE.MeshBasicMaterial({color:0xaebccc,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
  outer.position.y=13;g.add(outer);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(3.6,14,10),
    new THREE.MeshBasicMaterial({color:0xc8d6e4,transparent:true,opacity:0,depthWrite:false}));
  cap.position.y=25;cap.scale.y=0.55;g.add(cap);
  // flung dust chunks
  const chunks=[];
  for(let i=0;i<(LOW_END?4:8);i++){
    const c=new THREE.Mesh(new THREE.DodecahedronGeometry(0.3+Math.random()*0.3,0),
      new THREE.MeshStandardMaterial({color:0x9aa4b0,roughness:1,transparent:true}));
    const a=Math.random()*Math.PI*2, sp=3+Math.random()*5;
    c.userData.v=new THREE.Vector3(Math.cos(a)*sp,16+Math.random()*10,Math.sin(a)*sp);
    c.position.y=1;g.add(c);chunks.push(c);
  }
  g.userData={core,outer,cap,chunks};return g;
}
function spawnGeyser(nearShip){
  if(S.state!=='playing'||World.name!=='moon')return;
  // target a spot: near the ship's lead position, or scattered around it
  const lead=1.4;
  const ax=saucer.position.x+S.vel.x*lead, az=saucer.position.z+S.vel.z*lead;
  const spread=nearShip?(Math.random()*4):(10+Math.random()*22);
  const a=Math.random()*Math.PI*2;
  const gx=ax+Math.cos(a)*spread, gz=az+Math.sin(a)*spread;
  const gy=heightAt(gx,gz);
  const grp=new THREE.Group();grp.position.set(gx,gy+0.1,gz);
  const vent=makeGeyserVent();grp.add(vent);          // the physical geyser
  const ring=makeGeyserRing();ring.scale.setScalar(6);grp.add(ring);
  scene.add(grp);
  geysers.push({grp,ring,vent,plume:null,x:gx,z:gz,r:6,t:0,phase:'warn',warnDur:1.7});
  sfxGeyserWarn();
}
export function clearGeysers(){for(let i=geysers.length-1;i>=0;i--){scene.remove(geysers[i].grp);geysers.splice(i,1);}}
export function resetGeysers(){clearGeysers();geyserTimer=7;}
export function updateGeysers(dt){
  if(World.name!=='moon'){if(geysers.length)clearGeysers();return;}
  // geysers only erupt during daytime — night is a safe window to work the herd.
  // Pause the countdown at night so waves don't bunch up at daybreak.
  if(S.dayF>=0.5){
    geyserTimer-=dt;
    if(geyserTimer<=0){
      geyserTimer=(18+Math.random()*18)/hazMult();
      banner(tr('banner.geysers'));
      beep(300,0.16,0.08);setTimeout(()=>beep(300,0.16,0.08),240);
      const n=hazCount();
      const hitIdx=(Math.random()*n)|0;             // one erupts right under the ship's path
      for(let k=0;k<n;k++)setTimeout(()=>spawnGeyser(k===hitIdx),k*220);
    }
  }
  const t=performance.now()*0.001;
  for(let i=geysers.length-1;i>=0;i--){
    const gy=geysers[i];gy.t+=dt;
    if(gy.phase==='warn'){
      // pulsing warning ring, shrinking inward as the clock runs out
      const k=gy.t/gy.warnDur;
      gy.ring.material.opacity=0.35+0.45*Math.abs(Math.sin(t*10));
      gy.ring.scale.setScalar(gy.r*(1.0-0.12*k));
      if(gy.t>=gy.warnDur){
        gy.phase='erupt';gy.t=0;
        gy.plume=makeGeyserPlume();gy.grp.add(gy.plume);
        sfxGeyserErupt();
        // instant danger check happens during erupt below
      }
    }else if(gy.phase==='erupt'){
      const k=Math.min(1,gy.t/0.4);               // fast rise
      const fade=1-Math.min(1,Math.max(0,(gy.t-0.9)/1.3));  // longer settle
      const op=Math.min(k,fade);
      const pu=gy.plume&&gy.plume.userData;
      if(pu){
        pu.core.material.opacity=0.85*op;pu.core.scale.y=0.2+0.8*k;pu.core.position.y=15*(0.2+0.8*k);
        pu.outer.material.opacity=0.5*op;pu.outer.scale.set(1+0.3*k,0.2+0.8*k,1+0.3*k);pu.outer.position.y=13*(0.2+0.8*k);
        pu.cap.material.opacity=0.55*op;pu.cap.position.y=20+10*k;pu.cap.scale.set(0.6+1.1*k,0.4+0.4*k,0.6+1.1*k);
        gy.plume.rotation.y+=dt*0.8;
        pu.chunks.forEach(c=>{c.userData.v.y-=22*dt;c.position.addScaledVector(c.userData.v,dt);
          if(c.position.y<0.5){c.position.y=0.5;}c.rotation.x+=dt*5;c.rotation.y+=dt*4;
          c.material.opacity=op;});
      }
      gy.ring.material.opacity=Math.max(0,0.5*(1-k));
      // lethal while the column is actively blasting up (unless cloaked)
      if(S.state==='playing'&&!S.cloak&&gy.t<1.0){
        const d=Math.hypot(saucer.position.x-gy.x,saucer.position.z-gy.z);
        if(d<gy.r*0.72){
          S.crashReason='geyser';S.state='crashing';S.vy=-4;
          BeamSFX.stop();S.prevBeam=false;
          sfxGeyserErupt();
        }
      }
      if(gy.t>2.2){scene.remove(gy.grp);geysers.splice(i,1);}
    }
  }
}
