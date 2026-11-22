/* =========================================================================
   THE WANDERER — a person on foot, in first person.

   Walks the terrain, rides up onto road decks and bridges, can't wade into
   water, and is stopped by barns and tree trunks. Three kinds of cover hide you
   from the saucers:

     · TREE    — standing under a canopy (any standing tree)
     · BRIDGE  — on the ground under a raised road deck
     · BARN    — inside a shelter (a barn, a house): HIDE / E beside one

   Firing the pulse gun gives your position away for a moment (`revealT`), so
   cover is somewhere to shoot FROM, not a place to shoot without consequence.

   Writes nothing outside P and the camera except the hidden player saucer's
   position, which the rest of the game still treats as "where the player is"
   (chunk streaming, weather, minimap, ambience).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { S } from '../core/state.js';
import { camera } from '../core/engine.js';
import { WATER_Y } from '../core/constants.js';
import { sample, heightAt, slopeAt } from '../world/terrain.js';
import { roadHeightAt } from '../world/roads.js';
import { props, buildings, shelters } from '../entities/registry.js';
import { saucer } from '../systems/saucer.js';
import { W_IN } from './controls.js';
import { beep } from '../audio/music.js';
import { UP } from './shop.js';

export const EYE=2.0;          // eye height above the feet (a person is ~2.2 units)
const WALK=5.2, RUN=9.0;       // units / s
const STEP_UP=1.3;             // how high a ledge (or a road deck) you just step onto
const SHELTER_REACH=6.5;       // how close to a shelter point to be offered HIDE

export const P={
  x:0,y:0,z:0, vx:0,vz:0,vy:0,
  yaw:0,pitch:0,
  cover:null,                  // 'tree' | 'bridge' | 'barn' | null
  revealT:0,                   // >0: just fired, cover does not count
  inBarn:null,                 // the shelter point we are inside, or null
  nearShelter:null,
  beamSlow:1,                  // movement multiplier set by an AI beam on you
  lift:0,                      // 0..1 how far a beam has you off the ground
  bob:0, kick:0,
};

const _e=new THREE.Euler(0,0,0,'YXZ');

export function resetPlayer(x,z,yaw){
  P.x=x; P.z=z; P.y=groundAt(x,z,999); P.vx=P.vz=P.vy=0;
  P.yaw=yaw; P.pitch=-0.05; P.cover=null; P.revealT=0; P.inBarn=null; P.nearShelter=null;
  P.beamSlow=1; P.lift=0; P.bob=0; P.kick=0;
}

/* Where a foot at height `fromY` would stand at (x,z): the terrain, or a road
   deck if it is low enough above us to step onto (walk under it otherwise). */
function groundAt(x,z,fromY){
  const g=heightAt(x,z);
  const d=roadHeightAt(x,z);
  if(d>-1e8&&d<=fromY+STEP_UP&&d>g-0.5)return Math.max(g,d);
  return g;
}
function deckOver(x,z){ return roadHeightAt(x,z); }

/* Can a foot at fromY step to (x,z)? Not into water (unless onto a deck),
   not up a cliff. */
function passable(x,z,fromY){
  const s=sample(x,z);
  const wet=s.biome==='water'||s.h<=WATER_Y+0.2;
  if(wet){
    const d=deckOver(x,z);
    return d>-1e8&&d>=WATER_Y&&d<=fromY+STEP_UP;
  }
  const d=deckOver(x,z);
  if(d>-1e8&&Math.abs(d-fromY)<STEP_UP)return true;    // on the tarmac, whatever is under it
  return slopeAt(x,z,1.5)<=1.15;
}

/* Barns, houses and tree trunks are solid: push the wanderer back out of them. */
function pushOut(){
  const lists=[buildings,props];
  for(const L of lists)for(let i=0;i<L.length;i++){
    const o=L[i], u=o.userData;
    if(!u||!u.solid||u.gone!=null||u.lift>0.02||!o.visible)continue;
    const dx=P.x-o.position.x, dz=P.z-o.position.z;
    if(Math.abs(dx)>14||Math.abs(dz)>14)continue;
    if(u.fallen>=1)continue;                           // a felled log: step over it
    const isTree=u.sway!=null;
    const r=isTree?(u.rad||1)*0.32+0.45:(u.rad||2)*0.9+0.5;
    const d2=dx*dx+dz*dz;
    if(d2>=r*r||d2<1e-6)continue;
    if(P.y>o.position.y+(u.top||4))continue;           // standing on top of it (a bridge over a barn?)
    const d=Math.sqrt(d2), k=(r-d)/d;
    P.x+=dx*k; P.z+=dz*k;
  }
}

/* Canopy radius of a standing tree — derived from its measured trunk radius
   (measureSolid shrinks a slim solid's radius to 0.42 of its half-width). */
function underTree(){
  for(let i=0;i<props.length;i++){
    const o=props[i], u=o.userData;
    if(u.sway==null||u.fallen||u.gone!=null||u.lift>0.02)continue;
    const dx=P.x-o.position.x, dz=P.z-o.position.z;
    const r=(u.rad||1)/0.42*0.78;
    if(dx*dx+dz*dz<r*r)return true;
  }
  return false;
}
function nearestShelter(){
  let best=null, bd=SHELTER_REACH;
  for(const s of shelters){
    const d=Math.hypot(s.x-P.x,s.z-P.z);
    if(d<bd){bd=d;best=s;}
  }
  return best;
}

export function updatePlayer(dt){
  // ---- look ----
  P.yaw-=W_IN.lookDX; P.pitch-=W_IN.lookDY; W_IN.lookDX=W_IN.lookDY=0;
  P.pitch=Math.max(-1.45,Math.min(1.45,P.pitch));
  P.revealT=Math.max(0,P.revealT-dt);
  P.kick=Math.max(0,P.kick-dt*3.2);

  P.nearShelter=P.inBarn?null:nearestShelter();

  // ---- shelters: in / out ----
  if(W_IN.hidePress){
    W_IN.hidePress=false;
    if(P.inBarn)leaveBarn();
    else if(P.nearShelter){ P.inBarn=P.nearShelter; P.vx=P.vz=0; beep(220,0.12,0.05); }
  }
  if(P.inBarn&&Math.hypot(W_IN.mx,W_IN.my)>0.5)leaveBarn();      // walking off leaves the shelter

  if(!P.inBarn){
    // ---- walk ----
    const sp=(W_IN.run?RUN+1.3*UP.legs:WALK)*P.beamSlow;
    const fx=-Math.sin(P.yaw), fz=-Math.cos(P.yaw);      // camera forward on the ground
    const rx=Math.cos(P.yaw),  rz=-Math.sin(P.yaw);      // camera right
    const tvx=(fx*W_IN.my+rx*W_IN.mx)*sp, tvz=(fz*W_IN.my+rz*W_IN.mx)*sp;
    const k=Math.min(1,dt*10);
    P.vx+=(tvx-P.vx)*k; P.vz+=(tvz-P.vz)*k;
    const nx=P.x+P.vx*dt, nz=P.z+P.vz*dt;
    if(passable(nx,nz,P.y)){ P.x=nx; P.z=nz; }
    else if(passable(nx,P.z,P.y)){ P.x=nx; P.vz*=0.5; }
    else if(passable(P.x,nz,P.y)){ P.z=nz; P.vx*=0.5; }
    else { P.vx=P.vz=0; }
    pushOut();

    // ---- vertical ----
    const stand=groundAt(P.x,P.z,P.y);
    if(stand>=P.y){ P.y+=(stand-P.y)*Math.min(1,dt*18); if(stand-P.y<0.02)P.y=stand; P.vy=0; }
    else{ P.vy-=30*dt; P.y+=P.vy*dt; if(P.y<stand){P.y=stand;P.vy=0;} }
    const spd=Math.hypot(P.vx,P.vz);
    P.bob+=dt*spd*1.15;
  }

  // ---- cover ----
  if(P.inBarn)P.cover='barn';
  else{
    const d=deckOver(P.x,P.z);
    if(d>-1e8&&d-P.y>2.4)P.cover='bridge';
    else if(underTree())P.cover='tree';
    else P.cover=null;
  }

  // ---- camera ----
  const spd=Math.hypot(P.vx,P.vz);
  const bobA=Math.min(1,spd/RUN)*0.09;
  const shake=P.lift>0?(Math.sin(performance.now()*0.031)*0.05+Math.sin(performance.now()*0.047)*0.04)*P.lift:0;
  const liftY=P.lift*P.lift*3.2;
  camera.position.set(P.x, P.y+EYE+Math.sin(P.bob*2)*bobA+liftY, P.z);
  _e.set(P.pitch+P.kick*0.06+shake, P.yaw, shake*0.6);
  camera.quaternion.setFromEuler(_e);
  S.yaw=P.yaw;                                          // minimap + ambience panning read this
  S.agl=2;
  // The (hidden) player saucer marks "where the player is" for the shared systems.
  saucer.position.set(P.x,P.y+20,P.z);
}

function leaveBarn(){
  const s=P.inBarn; P.inBarn=null;
  if(!s)return;
  // step back out the way we came in, a little clear of the walls
  let dx=P.x-s.x, dz=P.z-s.z; const l=Math.hypot(dx,dz);
  if(l<0.5){ dx=-Math.sin(P.yaw); dz=-Math.cos(P.yaw); } else { dx/=l; dz/=l; }
  if(l<4){ P.x=s.x+dx*4.5; P.z=s.z+dz*4.5; }
  beep(180,0.1,0.04);
}

/* Is the wanderer visible to a saucer right now? */
export function playerVisible(){
  if(P.inBarn)return false;
  return !P.cover||P.revealT>0;
}
