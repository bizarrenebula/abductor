/* =========================================================================
   EARTH ANIMALS — sheep / camel / goat / duck (custom model when loaded, else
   procedural), plus the shared per-frame hop/idle updater that also dispatches
   humans and wormlings to their own updaters.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, WATER_Y, MTN_H } from '../core/constants.js';
import { lerp, wrapAngle, turnToward } from '../core/math.js';
import { mat, part } from '../core/mesh.js';
import { S } from '../core/state.js';
import { heightAt, sample } from '../world/terrain.js';
import { roadDist, ROAD_HW } from '../world/roads.js';
import { LOADED, spawnModel } from '../assets.js';
import { animals } from './registry.js';
import { saucer } from '../systems/saucer.js';
import { effBeamR } from '../systems/beam.js';
import { updateHuman } from './humans.js';
import { updateWorm } from './aliens.js';

/* turn = yaw speed in rad/s while pivoting in place. Heavier animals swing
   round slowly, which is most of what sells the weight difference. */
/* Species table (keyed by name). class: 'land' grazers, 'water' ducks, 'air'
   birds. Birds fly over anything and are quicker than sheep. */
export const ANIMALS={
  Sheep:{pts:1, size:1.1,  turn:2.6, cls:'land'},
  Goat :{pts:4, size:0.95, turn:3.4, cls:'land'},
  Duck :{pts:2, size:0.7,  turn:2.2, cls:'water'},
  Bird :{pts:2, size:0.5,  turn:3.2, cls:'air', hover:11, hopDist:7, hopRng:5, hopDur:0.42, restMin:0.7, restRng:1.5},
};
export function buildAnimal(species){
  const info=ANIMALS[species]||ANIMALS.Sheep;
  if(!ANIMALS[species])species='Sheep';
  const s=info.size*OBJ_SCALE;
  // --- custom model path (only sheep/duck/goat ever had GLBs; skipped in pure-JS) ---
  const modelName={Sheep:'sheep',Duck:'duck',Goat:'goat'}[species]||null;
  if(modelName&&LOADED[modelName]){
    const g=spawnModel(modelName);
    g.scale.setScalar(s);
    g.userData.legY=0;g.userData.biome=info.cls;g.userData.name=species;
    g.userData.hopTimer=1+Math.random()*2.5;
    g.userData.hop=null;g.userData.progress=0;g.userData.abducting=0;g.userData.face=Math.random()*6.28;
    g.userData.pts=info.pts;g.userData.baseS=s;
    g.userData.phase='idle';g.userData.turnRate=info.turn;g.rotation.y=g.userData.face;
    return g;
  }
  const g=new THREE.Group();
  const eyeM=new THREE.MeshBasicMaterial({color:0xd8efe0});
  const eyes=(x,y,z,r)=>{g.add(part(new THREE.SphereGeometry(r,6,6),eyeM,-x,y,z));
    g.add(part(new THREE.SphereGeometry(r,6,6),eyeM,x,y,z));};
  if(species==='Duck'){
    const bodyM=mat(0x5b4a33,0.7);
    const b=part(new THREE.SphereGeometry(1,16,12),bodyM,0,0.7,0);b.scale.set(1.35,0.85,1.05);g.add(b);
    const tail=part(new THREE.ConeGeometry(0.35,0.7,10),bodyM,0,0.85,-1.15);tail.rotation.x=-1.4;g.add(tail);
    g.add(part(new THREE.CylinderGeometry(0.26,0.34,0.5,10),mat(0xe6e6e0,0.6),0,1.12,0.7));
    g.add(part(new THREE.SphereGeometry(0.5,16,12),mat(0x1c5a3c,0.35),0,1.5,0.85));
    eyes(0.2,1.6,1.2,0.07);
    const bill=part(new THREE.ConeGeometry(0.2,0.55,10),mat(0xe8a13a,0.5),0,1.5,1.35);bill.rotation.x=Math.PI/2;g.add(bill);
  }else if(species==='Sheep'){
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
  }else if(species==='Bird'){
    // bird: small body, swept wings that flap, bright beak. Colour randomized.
    const fe=mat([0x2c3a4a,0x3a2a2a,0x46464e,0x244034][(Math.random()*4)|0],0.7);
    const body=part(new THREE.SphereGeometry(0.5,12,10),fe,0,0,0);body.scale.set(0.8,0.72,1.35);g.add(body);
    const head=part(new THREE.SphereGeometry(0.3,10,8),fe,0,0.24,0.6);g.add(head);
    const beak=part(new THREE.ConeGeometry(0.1,0.36,7),mat(0xe0a030,0.5),0,0.2,0.98);beak.rotation.x=Math.PI/2;g.add(beak);
    const wl=part(new THREE.BoxGeometry(1.15,0.06,0.5),fe,-0.72,0.06,0);wl.rotation.z=0.18;g.add(wl);
    const wr=part(new THREE.BoxGeometry(1.15,0.06,0.5),fe,0.72,0.06,0);wr.rotation.z=-0.18;g.add(wr);
    g.add(part(new THREE.BoxGeometry(0.4,0.05,0.65),fe,0,0,-0.75));   // tail
    g.userData.wings=[wl,wr];
    eyes(0.14,0.3,0.78,0.05);
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
  g.userData.biome=info.cls;g.userData.name=species;
  g.userData.hopTimer=1+Math.random()*2.5;
  g.userData.hop=null; g.userData.progress=0; g.userData.abducting=0; g.userData.face=Math.random()*6.28;
  g.userData.pts=info.pts; g.userData.baseS=s;
  g.userData.phase='idle'; g.userData.turnRate=info.turn; g.rotation.y=g.userData.face;
  // movement flavour
  g.userData.fly=info.cls==='air'; g.userData.hover=info.hover||0;
  g.userData.hopDist=info.hopDist; g.userData.hopRng=info.hopRng; g.userData.hopDur=info.hopDur;
  g.userData.restMin=info.restMin; g.userData.restRng=info.restRng;
  return g;
}

/* ---------- animal movement (also dispatches humans + worms) ----------

   Creatures move like animals rather than like sprites: they never strafe.
   Each cycle is idle -> turn -> step. During `turn` the body pivots in place
   toward a new heading; only once it is facing that way does it `step`, and
   the step travels along the direction the model is actually pointing
   (+Z local, which is the model's nose after the per-asset rotY correction
   in assets.js). Interrupting by clearing u.hop still works — see special.js.
*/
const TURN_EPS=0.02;      // radians: close enough to "facing that way"

function flap(u){
  if(!u.wings)return;
  const f=Math.sin(performance.now()*0.02+u.face)*0.55;
  u.wings[0].rotation.z=0.18+f; u.wings[1].rotation.z=-0.18-f;
}
// Which ground level does this creature ride at (birds fly above the surface,
// ducks float on the water, grazers stand on the land)?
function rideY(u,x,z){
  if(u.biome==='water')return WATER_Y+0.12;
  if(u.fly)return Math.max(heightAt(x,z),WATER_Y)+(u.hover||0);
  return heightAt(x,z)+(u.hover||0);
}
// Idle bob / float, shared by the idle and turning phases.
function settle(a,u){
  if(u.biome==='water'){
    const tt=performance.now()*0.001;
    a.position.y=WATER_Y+0.15+Math.sin(a.position.x*0.15+tt*1.1)*0.22+Math.cos(a.position.z*0.19+tt*1.4)*0.18;
  }else{
    a.position.y=rideY(u,a.position.x,a.position.z)+Math.sin(performance.now()*0.003+u.face)*(u.fly?0.6:u.hover?0.3:0.05);
    if(u.fly)flap(u);
  }
  if(u.pulse)a.scale.setScalar(u.baseS*(1+0.07*Math.sin(performance.now()*0.003+u.face)));
}

/* Can this creature step to (tx,tz)? Grazers avoid water, mountains, canyons,
   high ground and roads (they never cross a road); ducks stay on water; birds
   (u.fly) fly over anything so are never blocked. */
function stepOK(u,x0,z0,tx,tz){
  if(u.fly)return true;
  const s=sample(tx,tz);
  if(u.biome==='water')return s.biome==='water';
  if(s.biome==='water'||s.biome==='mountain'||s.biome==='canyon')return false;
  if(s.h>MTN_H-4)return false;
  if(roadDist(tx,tz)<ROAD_HW+2)return false;                       // never onto the tarmac
  if(roadDist((x0+tx)*0.5,(z0+tz)*0.5)<ROAD_HW+1)return false;      // never across it
  return true;
}

export function updateAnimals(dt){
  for(const a of animals){
    if(a.userData.abducting>0) continue;
    const u=a.userData;
    if(u.humanKind){updateHuman(a,u,dt);continue;}
    if(u.wormKind){updateWorm(a,u,dt);continue;}

    // special.js cancels movement by nulling u.hop; drop out of stepping too.
    if(u.phase==='step'&&!u.hop)u.phase='idle';

    // Night: grazers and ducks sleep in place (in their spawn groups) until the
    // tractor beam sweeps over them, then they wake and bolt. Birds fly on.
    if(!u.fly){
      const night=(S?S.dayF:1)<0.4;
      const dx=a.position.x-saucer.position.x, dz=a.position.z-saucer.position.z;
      const R=effBeamR()*1.7;
      const woke=S.beamPower>0.3 && (dx*dx+dz*dz)<R*R;
      if(night && !woke){
        u.phase='idle'; u.hop=null; if(u.hopTimer<0.6)u.hopTimer=0.6+Math.random();
        const g=(u.biome==='water')?WATER_Y+0.12:heightAt(a.position.x,a.position.z);
        a.position.y=g+0.02*Math.sin(performance.now()*0.0015+u.face);   // slow sleeping breath
        continue;
      }
    }

    if(u.phase==='turn'){
      a.rotation.y=turnToward(a.rotation.y,u.turnTo,(u.turnRate||2.8)*dt);
      settle(a,u);
      if(Math.abs(wrapAngle(u.turnTo-a.rotation.y))<TURN_EPS){
        // Facing the new heading — commit the step, unless it would leave valid
        // ground (water/mountain/canyon) or cross a road: then pick a new heading.
        const dspd=0.7+0.55*(S?S.dayF:1);              // day faster, night slower
        const dist=(u.hopDist||3)+Math.random()*(u.hopRng||2.5);
        const fx=Math.sin(a.rotation.y), fz=Math.cos(a.rotation.y);
        const tx=a.position.x+fx*dist, tz=a.position.z+fz*dist;
        if(!stepOK(u,a.position.x,a.position.z,tx,tz)){
          u.turnTo=wrapAngle(a.rotation.y+(Math.random()<0.5?-1:1)*(1.6+Math.random()*1.2));   // turn away, retry
        }else{
          u.hop={fx:a.position.x,fz:a.position.z,tx,tz,t:0,dur:(u.hopDur||0.55)/dspd};
          u.phase='step';
        }
      }
    }else if(u.phase==='step'){
      u.hop.t+=dt/u.hop.dur;
      const t=Math.min(1,u.hop.t);
      const x=lerp(u.hop.fx,u.hop.tx,t), z=lerp(u.hop.fz,u.hop.tz,t);
      const ground=rideY(u,x,z);
      if(u.fly)flap(u);
      a.position.set(x,ground+Math.sin(Math.PI*t)*0.5,z);
      if(u.roll)a.rotation.x+=dt*16;                   // tumblers spin as they go
      if(t>=1){
        u.hop=null;u.phase='idle';
        const rf=(S?(1.6-0.7*S.dayF):1);
        u.hopTimer=((u.restMin||1.4)+Math.random()*(u.restRng||2.6))*rf;
      }
    }else{
      settle(a,u);
      if(u.biome==='water')a.rotation.y+=Math.sin(performance.now()*0.001*0.7+u.face)*0.003;   // drift
      u.hopTimer-=dt;
      if(u.hopTimer<=0){
        // Mostly small course corrections, occasionally a real about-face, so
        // the herd doesn't read as a grid of things flipping 90 degrees.
        const big=Math.random()<0.3;
        const swing=(Math.random()*2-1)*(big?Math.PI:Math.PI/3);
        u.turnTo=wrapAngle(a.rotation.y+swing);
        u.phase='turn';
      }
    }
  }
}
