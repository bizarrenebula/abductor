/* =========================================================================
   VEHICLES — traffic that drives the road network and pulls over when the
   saucer comes overhead.

   A vehicle never stores an (x,z) it integrates freely: it stores the road it
   belongs to (axis + k) and a scalar `t` along that road's axis, then reads
   its cross-axis position back from the road function every frame. That is
   what keeps traffic glued to the meander instead of drifting off the tarmac.

   Custom models degrade to procedural boxes, so this works before
   car1/car2/bus1.glb exist.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { OBJ_SCALE, ASSETS, VEH_STOP_R } from '../core/constants.js';
import { lerp, clamp, turnToward } from '../core/math.js';
import { mat, part } from '../core/mesh.js';
import { S } from '../core/state.js';
import { effBeamR } from '../systems/beam.js';
import { heightAt } from '../world/terrain.js';
import { CHUNK } from '../core/constants.js';
import { scene } from '../core/engine.js';
import { roadSample, ROAD_LANE, ROAD_S, ROAD_K0, junctionMode, kAt } from '../world/roads.js';
import { LOADED, spawnModel } from '../assets.js';
import { animals, vehicles } from './registry.js';
import { buildHuman } from './humans.js';
import { chunks, chunkKey } from '../world/chunks.js';
import { saucer } from '../systems/saucer.js';
import { carHonk } from '../audio/sfx.js';
import { headlightRig } from '../systems/nightlights.js';

/* `block` marks a vehicle tall enough to stop the ship rather than be flown
   over. Cars are low: you always clear them. A bus is not — meet one at its own
   height and the saucer is pushed back instead of passing through it. */
export const VEHICLES={
  car1:{ model:'car1', len:2.3, cruise:15, w:1.5, h:1.2, col:0x9a3b2e },
  car2:{ model:'car2', len:2.4, cruise:17, w:1.5, h:1.2, col:0x2e4f7a },
  bus1:{ model:'bus1', len:4.4, cruise:10, w:1.9, h:2.4, col:0x6a6350, block:true },
};

function procVehicle(kind){
  const V=VEHICLES[kind], g=new THREE.Group();
  const body=mat(V.col,0.6), glass=mat(0x11181c,0.25), tyre=mat(0x0d0d0f,0.95);
  g.add(part(new THREE.BoxGeometry(V.w,V.h*0.62,V.len),body,0,V.h*0.52,0));
  if(kind==='bus1'){
    g.add(part(new THREE.BoxGeometry(V.w*0.96,V.h*0.34,V.len*0.9),glass,0,V.h*0.92,0));
  }else{
    const cab=part(new THREE.BoxGeometry(V.w*0.86,V.h*0.42,V.len*0.46),glass,0,V.h*0.92,-0.1);
    g.add(cab);
  }
  // headlights at +Z: the nose, matching the facing convention
  const lampM=new THREE.MeshBasicMaterial({color:0xffe9b8});
  g.add(part(new THREE.SphereGeometry(0.11,6,6),lampM,-V.w*0.32,V.h*0.5,V.len*0.5));
  g.add(part(new THREE.SphereGeometry(0.11,6,6),lampM, V.w*0.32,V.h*0.5,V.len*0.5));
  const wz=V.len*0.32;
  [[-V.w*0.5,wz],[V.w*0.5,wz],[-V.w*0.5,-wz],[V.w*0.5,-wz]].forEach(p=>{
    const w=part(new THREE.CylinderGeometry(0.26,0.26,0.18,10),tyre,p[0],0.26,p[1]);
    w.rotation.z=Math.PI/2;g.add(w);
  });
  g.scale.setScalar(OBJ_SCALE);
  return g;
}

export function buildVehicle(kind){
  const V=VEHICLES[kind];
  let g=null;
  if(LOADED[V.model]){
    g=spawnModel(V.model);
    if(g)g.scale.setScalar((ASSETS[V.model].scale||1)*OBJ_SCALE);
  }
  if(!g)g=procVehicle(kind);
  const u=g.userData;
  u.vehicle=kind;
  u.cruise=V.cruise*(0.85+Math.random()*0.3);
  u.speed=u.cruise;
  u.lift=0;u.fall=0;u.vy=0;u.stun=0;u.spin=1;u.grabY=0;u.roadY=0;u.turnLock=0;
  u.collected=0;                                  // beam-grab state (see updateVehicles)
  u.occupants=kind==='bus1'?(2+((Math.random()*3)|0)):(1+((Math.random()*2)|0));
  u.block=!!V.block;u.blockR=V.w*OBJ_SCALE+2.2;u.blockH=V.h*OBJ_SCALE*1.35;
  u.nightDriver=Math.random()<0.32;              // only some cars are out at night (headlights on)
  const hr=headlightRig(V.w,V.len,V.len*0.5);     // forward pool + bulbs; glow fades in only at night
  g.add(hr);u.headlights=hr;
  return g;
}

/* Place a built vehicle onto a road and register it. */
export function placeVehicle(g,axis,k,t,dir){
  const u=g.userData;
  u.axis=axis;u.k=k;u.t=t;u.dir=dir;
  u.lane=ROAD_LANE;                // right-hand lane centre (shared with the paint)
  syncVehicle(g,0);
  vehicles.push(g);
  return g;
}

/* Write world position + yaw from (axis,k,t,dir). dt only drives the yaw ease.
   Height comes from the road deck, not the terrain, so traffic rides bridges
   and stays on the carriageway where it has been routed around a hill. */
function syncVehicle(g,dt){
  const u=g.userData;
  const sp=roadSample(u.axis,u.k,u.t);
  // keep right: perpendicular to travel is (fz,-fx)
  const px=sp.x+sp.fz*u.lane, pz=sp.z-sp.fx*u.lane;
  u.roadY=sp.y;
  g.position.set(px,sp.y,pz);
  const yaw=Math.atan2(sp.fx,sp.fz);
  g.rotation.y=dt>0?turnToward(g.rotation.y,yaw,6*dt):yaw;
  // pitch along the deck gradient rather than the ground beneath it
  const ahead=roadSample(u.axis,u.k,u.t+u.dir*2.0);
  g.rotation.x=clamp(Math.atan2(sp.y-ahead.y,2.0),-0.5,0.5);
}

/* Tip the occupants out of a vehicle the beam has hold of. They land beside it
   and bolt in random directions. Registered against the nearest chunk so they
   are cleaned up on unload like any other spawned human. */
function bailOut(g){
  const u=g.userData;
  if(u.dumped||!u.occupants)return;
  u.dumped=1;
  const ck=chunks.get(chunkKey(Math.round(g.position.x/CHUNK),Math.round(g.position.z/CHUNK)));
  for(let i=0;i<u.occupants;i++){
    const a=Math.random()*Math.PI*2, r=1.6+Math.random()*2.4;
    const hx=g.position.x+Math.cos(a)*r, hz=g.position.z+Math.sin(a)*r;
    const hu=buildHuman('villager');
    hu.userData.scatter=1;
    hu.userData.bolt=(Math.random()*2-1)*3.0;   // full-circle scatter, not just away
    hu.userData.fleeT=2.6;                      // already running when they land
    hu.position.set(hx,heightAt(hx,hz),hz);
    hu.rotation.y=a;
    scene.add(hu);animals.push(hu);
    if(ck)ck.animals.push(hu);
  }
}

const TURN_CHANCE=0.4;   // odds a car turns rather than going straight at a level crossroad

/* ---- beam-grab tuning ---------------------------------------------------
   A grabbed vehicle grants no score: its occupants bail out (bailOut) and the
   empty shell is hauled up, then dropped cinematically on release. */
const DROP_G=16;         // cinematic gravity for the release drop (old was 34)

/* At a level crossroad a car may turn onto the crossing corridor (either way) or
   carry straight on; at an overpass it can't turn, it just passes under/over. jc
   is the grid coordinate (multiple of ROAD_S) it just reached along its axis. */
function tryTurn(u,jc){
  const kx=u.axis==='x'?jc:u.k, kz=u.axis==='x'?u.k:jc;
  if(junctionMode(kx,kz).overpass)return;          // separated levels — no turning
  if(Math.random()>=TURN_CHANCE)return;            // most traffic drives straight through
  const cross=roadSample(u.axis,u.k,jc);           // the junction point on our current road
  u.axis=u.axis==='x'?'z':'x';                     // hop onto the crossing corridor
  u.k=jc;
  u.t=u.axis==='x'?cross.x:cross.z;
  u.dir=Math.random()<0.5?1:-1;                    // left or right
  u.turnLock=ROAD_S*0.25;                          // don't re-trigger on this same node
}

export function updateVehicles(dt,beamActive){
  if(S.state!=='playing'&&S.state!=='crashing')return;
  const R=beamActive?effBeamR():-1;
  const night=S.dayF<0.5;                 // same threshold the geysers use
  for(const g of vehicles){
    const u=g.userData;
    // Far fewer cars are out at night: only the flagged night drivers keep going
    // (with their headlights on), the rest park and hide. A car already in the air
    // keeps its physics so a beam grab that straddles dusk still resolves.
    if(night&&!u.nightDriver&&u.lift===0&&u.fall===0){
      u.speed=0;g.visible=false;continue;
    }
    g.visible=true;
    // headlights only make sense with wheels on the road — hide the rig in the air
    if(u.headlights)u.headlights.visible=(u.lift===0&&u.fall===0);
    const dx=g.position.x-saucer.position.x, dz=g.position.z-saucer.position.z;
    const d2=dx*dx+dz*dz;

    /* ---- cinematic drop ----
       Once collected (or dropped empty) the car tumbles down under slowed
       gravity, spinning on every axis, then settles level on its road deck. */
    if(u.fall>0){
      u.fall-=dt;
      u.vy-=DROP_G*dt;                                   // ~half the old pull: floaty, dramatic
      g.position.y+=u.vy*dt;
      g.rotation.z+=dt*1.6*u.spin;                       // tumble...
      g.rotation.x+=dt*1.3*u.spin;                       // ...on multiple axes
      g.rotation.y+=dt*0.8;                              // with residual yaw
      if(g.position.y<=u.roadY||u.fall<=0){
        g.position.y=u.roadY;g.rotation.z=0;g.rotation.x=0;u.fall=0;u.lift=0;u.vy=0;
        u.stun=1.2;                                     // sits still, shaken
      }
      continue;
    }
    const inBeam=R>0&&d2<R*R;
    if(inBeam){
      /* ---- beam grab: the vehicle tips its occupants out onto the ground below,
         where they scatter and bolt. The vehicle grants NO points itself — the
         payoff is the fleeing NPCs, which the player can beam next. The empty
         shell is still hauled up cinematically. ---- */
      if(u.lift===0){u.grabY=g.position.y;carHonk();bailOut(g);}   // eject riders + honk on grab
      u.lift=Math.min(1,u.lift+dt*0.5);
      // Rise slowly to, and then FLOAT at, the midpoint between the road and the
      // ship — held there while locked with a gentle bob, and trailing under the
      // saucer in x,z so it follows wherever the ship flies (drag it by flying).
      const midY=(u.roadY+saucer.position.y)*0.5+Math.sin(performance.now()*0.0025)*0.5;
      g.position.y+=(midY-g.position.y)*Math.min(1,dt*1.5);
      g.position.x+=(saucer.position.x-g.position.x)*Math.min(1,dt*1.4);
      g.position.z+=(saucer.position.z-g.position.z)*Math.min(1,dt*1.4);
      g.rotation.y+=dt*1.1;                             // slow yaw spin in the column
      g.rotation.z=Math.sin(performance.now()*0.004)*0.14;   // gentle sway
      continue;
    }
    if(u.lift>0&&!u.collected){                          // beam released while dragging: just drop
      u.collected=1;                                    // spent: won't re-trigger the grab
      u.fall=2.4;u.vy=0;u.spin=Math.random()<0.5?-1:1;  // start the cinematic drop
      continue;
    }
    if(u.lift>0){                                       // an emptied car drifting out of the beam: ease back to road
      u.lift=Math.max(0,u.lift-dt*1.6);
      g.position.y=u.roadY+(g.position.y-u.roadY)*0.86;
      g.rotation.z*=0.86;
      if(u.lift===0)g.position.y=u.roadY;
      continue;
    }
    if(u.stun>0){u.stun-=dt;u.speed=0;continue;}

    // Halt when the saucer is overhead — horizontal distance only, so it
    // triggers on a fly-over regardless of altitude. A cloaked ship is invisible,
    // so traffic keeps cruising until it decloaks (which the beam forces).
    const overhead=!S.cloak&&d2<VEH_STOP_R*VEH_STOP_R;
    u.halted=overhead;
    const want=overhead?0:u.cruise;
    u.speed=lerp(u.speed,want,Math.min(1,dt*(overhead?3.2:0.9)));
    if(u.speed>0.02){
      const before=u.t;
      u.t+=u.speed*u.dir*dt;
      // Did we drive across a junction coordinate this step? If so, maybe turn.
      if(u.turnLock>0){ u.turnLock-=Math.abs(u.t-before); }
      else{
        const lo=Math.min(before,u.t), hi=Math.max(before,u.t);
        const jc=kAt(Math.ceil((lo-ROAD_K0)/ROAD_S));
        if(jc<=hi)tryTurn(u,jc);
      }
      syncVehicle(g,dt);
    }
  }
}
