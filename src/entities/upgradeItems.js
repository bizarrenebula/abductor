/* =========================================================================
   UPGRADE ITEMS — the three findable ship parts (Thrusters, High-End Engine,
   Magnetic Ring). Each run scatters the not-yet-installed ones at random spots
   on the map, each with a tall glowing beacon so it reads from a distance, a
   ground ring, and extra highlight when it falls in the ship's line of sight.
   Fly over one to install it (works at any altitude — Thrusters has to be
   reachable while the ship is still grounded). Marked on the radar too.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { lerp } from '../core/math.js';
import { WATER_Y } from '../core/constants.js';
import { scene, camera } from '../core/engine.js';
import { heightAt } from '../world/terrain.js';
import { saucer } from '../systems/saucer.js';
import { Upgrades, UP_ITEMS, ITEM_KEYS } from '../systems/upgrades.js';
import { spawnPop } from '../ui/pop.js';
import { t } from '../i18n.js';

export const upgradeItems=[];   // live meshes; read by the minimap

const BEACON_H=72;              // pillar height — tall enough to clear terrain
const COLLECT_R=8;              // fly this close (horizontally) to install
const SPAWN_MIN=70, SPAWN_MAX=320;
const _v=new THREE.Vector3(), _pop=new THREE.Vector3();

function glowMat(col,op){
  return new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op,
    depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
}

function buildItem(key){
  const col=UP_ITEMS[key].col;
  const g=new THREE.Group();
  const solid=new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.95,
    metalness:0.4,roughness:0.3});
  // --- floating icon, a distinct silhouette per part ---
  const icon=new THREE.Group();
  if(key==='thrusters'){
    for(let i=0;i<3;i++){const a=i/3*Math.PI*2;
      const c=new THREE.Mesh(new THREE.ConeGeometry(0.5,1.5,12),solid);
      c.position.set(Math.cos(a)*0.9,0,Math.sin(a)*0.9);c.rotation.x=Math.PI;icon.add(c);}
    icon.userData.spinX=false;
  }else if(key==='highEngine'){
    icon.add(new THREE.Mesh(new THREE.OctahedronGeometry(1.15,0),solid));
    const r=new THREE.Mesh(new THREE.TorusGeometry(1.55,0.16,10,28),solid);r.rotation.x=Math.PI/2;icon.add(r);
    icon.userData.spinX=true;
  }else{ // magRing
    const r1=new THREE.Mesh(new THREE.TorusGeometry(1.45,0.34,14,32),solid);r1.rotation.x=Math.PI*0.5;icon.add(r1);
    const r2=new THREE.Mesh(new THREE.TorusGeometry(0.85,0.18,12,26),solid);r2.rotation.x=Math.PI*0.12;icon.add(r2);
    icon.userData.spinX=false;
  }
  g.add(icon);
  // --- beacon pillar + ground ring (additive glow) ---
  const beaconMat=glowMat(col,0.16);
  const beacon=new THREE.Mesh(new THREE.CylinderGeometry(1.0,1.7,BEACON_H,16,1,true),beaconMat);
  beacon.position.y=BEACON_H/2;g.add(beacon);
  const ringMat=glowMat(col,0.5);
  const ring=new THREE.Mesh(new THREE.RingGeometry(3,4,36),ringMat);
  ring.rotation.x=-Math.PI/2;ring.position.y=0.15;g.add(ring);
  g.userData={key,col,icon,beaconMat,ring,ringMat,phase:Math.random()*6.28,onScreen:false};
  return g;
}

/* Scatter every part that isn't already installed (installed ones stay carried
   through a crash, so they don't respawn). Called by startGame. */
export function spawnUpgradeItems(){
  clearUpgradeItems();
  for(const key of ITEM_KEYS){
    if(Upgrades.items[key])continue;
    const g=buildItem(key);
    const ang=Math.random()*Math.PI*2, d=SPAWN_MIN+Math.random()*(SPAWN_MAX-SPAWN_MIN);
    const x=Math.cos(ang)*d, z=Math.sin(ang)*d;
    g.position.set(x,Math.max(heightAt(x,z),WATER_Y),z);
    scene.add(g);upgradeItems.push(g);
  }
}
export function clearUpgradeItems(){
  for(const g of upgradeItems)scene.remove(g);
  upgradeItems.length=0;
}

export function updateUpgradeItems(dt){
  if(!upgradeItems.length)return;
  const time=performance.now()*0.001;
  const sx=saucer.position.x, sz=saucer.position.z;
  for(let i=upgradeItems.length-1;i>=0;i--){
    const g=upgradeItems[i], u=g.userData;
    // line of sight: is the part on screen and in front of the camera?
    _v.set(g.position.x,g.position.y+4,g.position.z).project(camera);
    const onScreen=_v.z<1 && _v.x>-1 && _v.x<1 && _v.y>-1 && _v.y<1;
    u.onScreen=onScreen;
    // float + spin (livelier when you're looking right at it)
    u.icon.position.y=4+Math.sin(time*1.6+u.phase)*0.35;
    u.icon.rotation.y+=dt*(onScreen?2.6:1.1);
    if(u.icon.userData.spinX)u.icon.rotation.x+=dt*1.3;
    // highlight in line of sight: brighter beacon + livelier ring
    u.beaconMat.opacity=lerp(u.beaconMat.opacity,onScreen?0.5:0.16,Math.min(1,dt*4));
    const pulse=0.6+0.35*Math.sin(time*3+u.phase);
    u.ringMat.opacity=(onScreen?0.9:0.45)*pulse;
    u.ring.scale.setScalar(1+(onScreen?0.14:0.05)*Math.sin(time*3+u.phase));
    // install on close approach
    const dx=g.position.x-sx, dz=g.position.z-sz;
    if(dx*dx+dz*dz<COLLECT_R*COLLECT_R){
      Upgrades.collectItem(u.key);
      spawnPop(_pop.set(g.position.x,g.position.y+4,g.position.z),'★',t('upg.name.'+u.key));
      scene.remove(g);upgradeItems.splice(i,1);
    }
  }
}
