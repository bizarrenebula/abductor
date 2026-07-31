/* =========================================================================
   UPGRADE ITEMS — the findable ship parts (Thrusters, High-End Engine). Each
   run scatters the not-yet-installed ones far apart at random spots on the map,
   each GLOWING (shared objective marker) so it reads from a distance, with an
   on-screen arrow pointing the way until you arrive. The glow eases off over the
   last stretch as you close in. Fly over one to install it (works at
   any altitude — Thrusters has to be reachable while the ship is still
   grounded). Marked on the radar too.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { WATER_Y, COLLECT_SCALE } from '../core/constants.js';
import { scene, camera } from '../core/engine.js';
import { heightAt } from '../world/terrain.js';
import { S } from '../core/state.js';
import { saucer } from '../systems/saucer.js';
import { Upgrades, UP_ITEMS, ITEM_KEYS } from '../systems/upgrades.js';
import { spawnPop } from '../ui/pop.js';
import { objectiveGlow, updateGlow, mark } from '../systems/waypoints.js';
import { t } from '../i18n.js';

const _wp=new THREE.Vector3();

export const upgradeItems=[];   // live meshes; read by the minimap

const COLLECT_R=8;              // fly this close (horizontally) to install
const SEP_MIN=280;             // keep modules apart from each other where possible
const _v=new THREE.Vector3(), _pop=new THREE.Vector3();

function buildItem(key){
  const col=UP_ITEMS[key].col;
  const g=new THREE.Group();
  const solid=new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.95,
    metalness:0.4,roughness:0.3});
  // --- floating icon, a distinct silhouette per module ---
  const icon=new THREE.Group();
  if(key==='beam'){
    // a downward funnel (the tractor beam) over a disc
    const cone=new THREE.Mesh(new THREE.ConeGeometry(1.3,1.9,20,1,true),solid);cone.position.y=0.1;icon.add(cone);
    const r=new THREE.Mesh(new THREE.TorusGeometry(1.35,0.13,10,28),solid);r.rotation.x=Math.PI/2;r.position.y=-0.85;icon.add(r);
    icon.userData.spinX=false;
  }else if(key==='cloak'){
    // a ghostly diamond wrapped in a ring
    icon.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.1,0),solid));
    const r=new THREE.Mesh(new THREE.TorusGeometry(1.5,0.12,10,28),solid);r.rotation.x=Math.PI/2.4;icon.add(r);
    icon.userData.spinX=true;
  }else if(key==='thrusters'){
    for(let i=0;i<3;i++){const a=i/3*Math.PI*2;
      const c=new THREE.Mesh(new THREE.ConeGeometry(0.5,1.5,12),solid);
      c.position.set(Math.cos(a)*0.9,0,Math.sin(a)*0.9);c.rotation.x=Math.PI;icon.add(c);}
    icon.userData.spinX=false;
  }else{ // highEngine
    icon.add(new THREE.Mesh(new THREE.OctahedronGeometry(1.15,0),solid));
    const r=new THREE.Mesh(new THREE.TorusGeometry(1.55,0.16,10,28),solid);r.rotation.x=Math.PI/2;icon.add(r);
    icon.userData.spinX=true;
  }
  icon.scale.setScalar(COLLECT_SCALE);   // objects of interest read larger
  g.add(icon);
  // The part simply GLOWS until you are close enough to take it (shared marker,
  // also used by the story objectives), and an on-screen arrow points the way.
  const glow=objectiveGlow(col,1.15);
  g.add(glow);
  g.userData={key,col,icon,glow,phase:Math.random()*6.28,onScreen:false};
  return g;
}

/* Scatter every part that isn't already installed (installed ones stay carried
   through a crash, so they don't respawn). Called by startGame. */
export function spawnUpgradeItems(){
  clearUpgradeItems();
  const placed=[];
  for(const key of ITEM_KEYS){
    if(Upgrades.items[key])continue;
    const spec=UP_ITEMS[key], dMin=spec.dMin||380, dMax=spec.dMax||1150;
    let x,z,tries=0;
    do{
      const ang=Math.random()*Math.PI*2, d=dMin+Math.random()*(dMax-dMin);
      x=Math.cos(ang)*d; z=Math.sin(ang)*d; tries++;
    }while(tries<40 && placed.some(p=>Math.hypot(p.x-x,p.z-z)<SEP_MIN));
    placed.push({x,z});
    const g=buildItem(key);
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
    // float + steady spin
    u.icon.position.y=4+Math.sin(time*1.6+u.phase)*0.35;
    u.icon.visible=true;
    u.icon.rotation.y+=dt*1.2;
    if(u.icon.userData.spinX)u.icon.rotation.x+=dt*1.1;
    // Glow, no blinking: it keeps emitting light until you are close enough to
    // take it, then eases off over the last stretch as you close in.
    const dx=g.position.x-sx, dz=g.position.z-sz;
    const dist=Math.hypot(dx,dz);
    updateGlow(u.glow,time,Math.min(1,Math.max(0,(dist-COLLECT_R)/22)));
    // During a tutorial lesson only the taught objective gets an arrow, so the
    // parts keep glowing but stay out of the guidance until the lessons are done.
    if(!S.tutorialLesson)
      mark(_wp.set(g.position.x,g.position.y+5,g.position.z),'#'+u.col.toString(16).padStart(6,'0'),COLLECT_R+4);
    // install on close approach
    if(dx*dx+dz*dz<COLLECT_R*COLLECT_R){
      Upgrades.collectItem(u.key);
      spawnPop(_pop.set(g.position.x,g.position.y+4,g.position.z),'★',t('upg.name.'+u.key));
      scene.remove(g);upgradeItems.splice(i,1);
    }
  }
}
