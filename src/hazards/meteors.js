/* =========================================================================
   MARS METEOR SHOWERS — telegraphed showers of charred, glowing rocks that
   streak in on a slant. A direct hit (uncloaked) is critical; ground impacts
   throw debris and shockwave rings.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { World } from '../world/world-config.js';
import { heightAt } from '../world/terrain.js';
import { saucer } from '../systems/saucer.js';
import { beep } from '../audio/music.js';
import { sfxMeteorIncoming, sfxMeteorImpact, BeamSFX } from '../audio/sfx.js';
import { banner } from '../ui/banner.js';
import { hazMult, hazCount } from './common.js';

const LOW_END = env.LOW_END;

const meteors=[];
const impacts=[];
let meteorTimer=8;
let meteorWarn=0;
function buildMeteorRock(){
  // charred, pitted stone with molten glowing veins
  const g=new THREE.Group();
  const sz=0.75+Math.random()*0.5;
  const body=new THREE.Mesh(new THREE.IcosahedronGeometry(sz,1),
    new THREE.MeshStandardMaterial({color:0x241712,emissive:0xff5a1e,emissiveIntensity:0.55,
      roughness:0.95,metalness:0.15,flatShading:true}));
  // deform verts a little for an irregular chunk
  const pos=body.geometry.attributes.position;
  for(let i=0;i<pos.count;i++){const f=0.8+Math.random()*0.4;
    pos.setXYZ(i,pos.getX(i)*f,pos.getY(i)*f,pos.getZ(i)*f);}
  body.geometry.computeVertexNormals();
  g.add(body);
  // white-hot leading core
  const core=new THREE.Mesh(new THREE.SphereGeometry(sz*0.7,12,10),
    new THREE.MeshBasicMaterial({color:0xffdca0,transparent:true,opacity:0.9,depthWrite:false}));
  g.add(core);
  // fireball halo
  const halo=new THREE.Mesh(new THREE.SphereGeometry(sz*1.7,12,10),
    new THREE.MeshBasicMaterial({color:0xff7a30,transparent:true,opacity:0.32,depthWrite:false,
      blending:THREE.AdditiveBlending}));
  g.add(halo);
  g.userData.sz=sz;g.userData.halo=halo;
  return g;
}
function buildMeteorTrail(){
  // a tapering ribbon of fading embers behind the rock, built from stacked billboards
  const trail=new THREE.Group();
  const seg=LOW_END?5:10;
  trail.userData.puffs=[];
  for(let i=0;i<seg;i++){
    const f=i/seg;
    const s=(1-f)*1.7+0.3;
    const puff=new THREE.Mesh(new THREE.SphereGeometry(s,8,7),
      new THREE.MeshBasicMaterial({color:new THREE.Color().setHSL(0.06-0.06*f,1,0.5+0.15*(1-f)),
        transparent:true,opacity:(1-f)*0.5,depthWrite:false,blending:THREE.AdditiveBlending}));
    trail.add(puff);trail.userData.puffs.push(puff);
  }
  return trail;
}
function spawnMeteor(bullseye){
  if(S.state!=='playing'||World.name!=='mars')return;
  const m=buildMeteorRock();
  const trail=buildMeteorTrail();scene.add(trail);
  // aim point: lead the saucer's motion, then either a near-miss ring or a direct hit
  const lead=1.1;
  const aimX=saucer.position.x+S.vel.x*lead;
  const aimZ=saucer.position.z+S.vel.z*lead;
  const spread=bullseye?(Math.random()*2.5):(6+Math.random()*14);
  const sa=Math.random()*Math.PI*2;
  const tx=aimX+Math.cos(sa)*spread, tz=aimZ+Math.sin(sa)*spread;
  const startY=155+Math.random()*30;
  const fall=74+Math.random()*20;
  const tt=startY/fall;
  // come in at a slant (real meteors streak diagonally, not straight down)
  const slantAng=Math.random()*Math.PI*2, slant=55+Math.random()*35;
  m.position.set(tx+Math.cos(slantAng)*slant, startY, tz+Math.sin(slantAng)*slant);
  m.userData.vel=new THREE.Vector3((tx-m.position.x)/tt,-fall,(tz-m.position.z)/tt);
  m.userData.spin=1.5+Math.random()*3;
  m.userData.trail=trail;
  m.userData.hist=[];                          // recent positions for the tail
  m.userData.axis=new THREE.Vector3(Math.random()-0.5,Math.random()-0.5,Math.random()-0.5).normalize();
  scene.add(m);meteors.push(m);
  sfxMeteorIncoming();
}
function spawnImpactFlash(x,y,z,big){
  const g=new THREE.Group();g.position.set(x,y,z);
  const flash=new THREE.Mesh(new THREE.SphereGeometry(big?3.5:2,12,10),
    new THREE.MeshBasicMaterial({color:0xffb060,transparent:true,opacity:0.8,depthWrite:false,blending:THREE.AdditiveBlending}));
  g.add(flash);
  const ring=new THREE.Mesh(new THREE.RingGeometry(0.5,1.1,28),
    new THREE.MeshBasicMaterial({color:0xffcaa0,transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.y=0.2;g.add(ring);
  // debris shards flung outward
  const shards=[];
  const nn=LOW_END?(big?4:2):(big?7:4);
  for(let i=0;i<nn;i++){
    const s=new THREE.Mesh(new THREE.TetrahedronGeometry(0.3+Math.random()*0.35,0),
      new THREE.MeshStandardMaterial({color:0x2a1c14,emissive:0xff5a20,emissiveIntensity:0.5,roughness:0.9}));
    const a=Math.random()*Math.PI*2, sp=6+Math.random()*8;
    s.userData.v=new THREE.Vector3(Math.cos(a)*sp,5+Math.random()*6,Math.sin(a)*sp);
    g.add(s);shards.push(s);
  }
  g.userData={t:0,flash,ring,shards,big};
  scene.add(g);impacts.push(g);
}
export function clearMeteors(){
  for(let i=meteors.length-1;i>=0;i--){if(meteors[i].userData.trail)scene.remove(meteors[i].userData.trail);scene.remove(meteors[i]);meteors.splice(i,1);}
  for(let i=impacts.length-1;i>=0;i--){scene.remove(impacts[i]);impacts.splice(i,1);}
}
export function resetMeteors(){clearMeteors();meteorTimer=6;meteorWarn=0;}
function triggerShower(){
  meteorWarn=1.6;                                  // short telegraph before rocks fall
  banner('⚠ METEOR SHOWER — MOVE!');
  beep(300,0.18,0.09);setTimeout(()=>beep(300,0.18,0.09),260);setTimeout(()=>beep(300,0.18,0.09),520);
  const n=hazCount();
  const hitIdx=(Math.random()*n)|0;                // one is a bullseye on the ship
  for(let k=0;k<n;k++)setTimeout(()=>spawnMeteor(k===hitIdx),1600+k*260);
}
export function updateMeteors(dt){
  if(World.name!=='mars'){if(meteors.length)clearMeteors();meteorWarn=0;return;}
  if(meteorWarn>0)meteorWarn-=dt;
  // meteors only fall at night — daytime is a safe window to work the herd.
  // Pause the countdown by day so showers don't bunch up at nightfall.
  if(S.dayF<0.5){
    meteorTimer-=dt;
    if(meteorTimer<=0){
      meteorTimer=(22+Math.random()*18)/hazMult();   // more frequent on harder worlds / story
      triggerShower();
    }
  }
  for(let i=meteors.length-1;i>=0;i--){
    const m=meteors[i],u=m.userData;
    m.position.addScaledVector(u.vel,dt);
    m.rotateOnAxis(u.axis,u.spin*dt);
    if(u.halo)u.halo.material.opacity=0.28+0.12*Math.sin(performance.now()*0.02);
    // trail follows recent path, fading back
    u.hist.unshift(m.position.clone());
    if(u.hist.length>u.trail.userData.puffs.length)u.hist.pop();
    u.trail.userData.puffs.forEach((pf,j)=>{
      const h=u.hist[j];
      if(h){pf.visible=true;pf.position.copy(h);
        pf.material.opacity=(1-j/u.hist.length)*0.5;}
      else pf.visible=false;
    });
    if(S.state==='playing'&&!S.cloak&&m.position.distanceTo(saucer.position)<5.5){
      spawnImpactFlash(m.position.x,m.position.y,m.position.z,true);
      scene.remove(m);scene.remove(u.trail);meteors.splice(i,1);
      S.crashReason='meteor';S.state='crashing';S.vy=-6;
      BeamSFX.stop();S.prevBeam=false;
      sfxMeteorImpact(true);
      continue;
    }
    const gh=heightAt(m.position.x,m.position.z);
    if(m.position.y<=gh+0.5){
      const d=Math.hypot(m.position.x-saucer.position.x,m.position.z-saucer.position.z);
      spawnImpactFlash(m.position.x,gh+0.3,m.position.z,d<24);
      sfxMeteorImpact(d<24);
      scene.remove(m);scene.remove(u.trail);meteors.splice(i,1);
    }
  }
  // impact flashes: expand ring, fling shards, fade
  for(let i=impacts.length-1;i>=0;i--){
    const im=impacts[i],u=im.userData;u.t+=dt;
    const k=Math.min(1,u.t/0.6);
    u.flash.material.opacity=0.8*(1-k);u.flash.scale.setScalar(1+k*1.5);
    u.ring.scale.setScalar(1+k*(u.big?7:4));u.ring.material.opacity=0.7*(1-k);
    u.shards.forEach(s=>{s.userData.v.y-=26*dt;s.position.addScaledVector(s.userData.v,dt);
      s.rotation.x+=dt*6;s.rotation.z+=dt*5;s.material.opacity=1;});
    if(u.t>0.9){scene.remove(im);impacts.splice(i,1);}
  }
}
