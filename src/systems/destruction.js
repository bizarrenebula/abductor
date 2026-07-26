/* =========================================================================
   DESTRUCTION — when the ship rams a structure it takes damage too. Billboards,
   barns/houses and trees topple over and stay wrecked; gas stations explode in a
   fireball and leave a burned scorch, flames and scattered debris. Durable things
   (mountains, roads) take no damage — only the ship. Kept cheap: additive
   billboards/meshes and a handful of debris, no real lights or post-fx.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene } from '../core/engine.js';
import { buildings } from '../entities/registry.js';
import { chunks } from '../world/chunks.js';
import { heightAt } from '../world/terrain.js';
import { sfxMeteorImpact, noiseBurst } from '../audio/sfx.js';

const falling=[];   // structures toppling over
const fx=[];        // fireballs, debris, scorch decals

/* soft radial texture for the fireball/scorch (white centre → transparent). */
function softTex(){
  const c=document.createElement('canvas');c.width=c.height=64;
  const x=c.getContext('2d');const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.5,'rgba(255,255,255,0.55)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;
}
const SOFT=softTex();
const DEBRIS_GEO=new THREE.BoxGeometry(0.6,0.6,0.6);
const DEBRIS_MAT=new THREE.MeshStandardMaterial({color:0x2a2622,roughness:0.9,metalness:0.1,flatShading:true});

/* Called by collision when the hull hits object `o`. */
export function damageStruct(o){
  const u=o.userData;
  if(!u||u.dying)return;
  u.dying=1;
  if(u.station){ explodeStation(o); return; }
  if(u.sway){ toppleTree(o); return; }          // a tree prop
  toppleStructure(o);                            // billboard, barn, house, tower, lamp...
}

/* Topple a rigid structure onto the ground, where it stays wrecked. */
function toppleStructure(o){
  o.userData.solid=false;                        // wreckage no longer stops the ship
  falling.push({o,t:0,dur:0.75+Math.random()*0.3,
    axis:Math.random()<0.5?'x':'z',dir:Math.random()<0.5?1:-1,
    rx0:o.rotation.x,rz0:o.rotation.z});
  noiseBurst(0.6,0.14,'lowpass',260,70,0.8);     // heavy wooden crash
}

/* Trees fall via the props system's own uproot/topple path. */
function toppleTree(o){
  const u=o.userData;
  u.solid=false;u.uprooted=1;u.lift=Math.max(u.lift||0,0.3);   // updateProps drops + topples it
  u.toppleSign=Math.random()<0.5?1:-1;
  noiseBurst(0.5,0.12,'lowpass',300,90,0.8);
}

/* Gas station: fireball + scorch + debris, then it's gone. */
function explodeStation(o){
  const gx=o.position.x, gz=o.position.z, gy=o.position.y;
  sfxMeteorImpact(true);                          // deep boom + debris crackle
  // fireball
  const fire=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),
    new THREE.MeshBasicMaterial({color:0xffb648,transparent:true,opacity:0.95,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  fire.position.set(gx,gy+3,gz);scene.add(fire);
  fx.push({type:'fire',mesh:fire,t:0,dur:0.85});
  // a couple of soft smoke/flame billboards that rise and fade
  for(let i=0;i<3;i++){
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:SOFT,color:i?0x2a2420:0xff7a30,
      transparent:true,opacity:0.8,blending:i?THREE.NormalBlending:THREE.AdditiveBlending,depthWrite:false}));
    s.scale.setScalar(3+i);s.position.set(gx+(Math.random()-0.5)*2,gy+3,gz+(Math.random()-0.5)*2);
    scene.add(s);fx.push({type:'plume',mesh:s,t:0,dur:1.6+i*0.4,vy:3+i});
  }
  // persistent scorch decal
  const scorch=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
    new THREE.MeshBasicMaterial({map:SOFT,color:0x0a0503,transparent:true,opacity:0.9,depthWrite:false}));
  scorch.rotation.x=-Math.PI/2;scorch.scale.setScalar(16);scorch.position.set(gx,heightAt(gx,gz)+0.12,gz);
  scene.add(scorch);fx.push({type:'decal',mesh:scorch});
  // debris flung outward, lands and stays
  for(let i=0;i<8;i++){
    const d=new THREE.Mesh(DEBRIS_GEO,DEBRIS_MAT);
    d.scale.setScalar(0.5+Math.random()*1.1);
    d.position.set(gx,gy+2+Math.random()*2,gz);
    const a=Math.random()*6.28, sp=6+Math.random()*10;
    scene.add(d);
    fx.push({type:'debris',mesh:d,vx:Math.cos(a)*sp,vz:Math.sin(a)*sp,vy:6+Math.random()*8,
      sx:(Math.random()-0.5)*10,sz:(Math.random()-0.5)*10,gy:heightAt(d.position.x,d.position.z)+0.3});
  }
  // remove the station itself from the world
  removeFromScene(o);
}

function removeFromScene(o){
  scene.remove(o);
  const bi=buildings.indexOf(o); if(bi>=0)buildings.splice(bi,1);
  for(const [,c] of chunks){ const j=c.builds.indexOf(o); if(j>=0){c.builds.splice(j,1);break;} }
}

export function updateDestruction(dt){
  // toppling structures — rotate onto their side, ease out, then rest wrecked
  for(let i=falling.length-1;i>=0;i--){
    const f=falling[i],o=f.o; f.t+=dt;
    const k=Math.min(1,f.t/f.dur), e=k*(2-k);               // easeOutQuad
    const ang=1.5*e*f.dir;
    if(f.axis==='x')o.rotation.x=f.rx0+ang; else o.rotation.z=f.rz0+ang;
    if(k>=1)falling.splice(i,1);
  }
  // explosion fx
  for(let i=fx.length-1;i>=0;i--){
    const e=fx[i];
    if(e.type==='fire'){
      e.t+=dt;const k=e.t/e.dur;
      e.mesh.scale.setScalar(1+8*k);
      e.mesh.material.opacity=Math.max(0,0.95*(1-k));
      e.mesh.material.color.setRGB(1,0.55-0.4*k,0.2-0.18*k);
      if(k>=1){scene.remove(e.mesh);fx.splice(i,1);}
    }else if(e.type==='plume'){
      e.t+=dt;const k=e.t/e.dur;
      e.mesh.position.y+=e.vy*dt;e.vy*=0.98;
      e.mesh.scale.setScalar((3+i)+6*k);
      e.mesh.material.opacity=Math.max(0,0.8*(1-k));
      if(k>=1){scene.remove(e.mesh);fx.splice(i,1);}
    }else if(e.type==='debris'){
      e.vy-=34*dt;
      e.mesh.position.x+=e.vx*dt;e.mesh.position.y+=e.vy*dt;e.mesh.position.z+=e.vz*dt;
      e.mesh.rotation.x+=e.sx*dt;e.mesh.rotation.z+=e.sz*dt;
      if(e.mesh.position.y<=e.gy){
        e.mesh.position.y=e.gy;e.vy*=-0.3;e.vx*=0.4;e.vz*=0.4;e.sx*=0.4;e.sz*=0.4;
        if(Math.abs(e.vy)<1.2){e.type='rest';}               // settled — stays as ground debris
      }
    }
    // 'decal' and 'rest' just persist
  }
}

/* Fresh run: clear all wreckage/fx so the world starts clean. */
export function resetDestruction(){
  for(const f of falling)f.o.userData.dying=0;
  falling.length=0;
  for(const e of fx)if(e.mesh)scene.remove(e.mesh);
  fx.length=0;
}
