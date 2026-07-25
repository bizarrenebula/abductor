/* =========================================================================
   NIGHT LIGHTS — cheap, performant pools of light for night: street lamps
   along the roads, lit gas-station forecourts, and vehicle headlights. Real
   dynamic lights are far too many to place per pole/car, so instead every
   light is EMISSIVE geometry (a glowing bulb) plus an additive ground-glow
   DECAL (a soft disc laid on the terrain) that reads as a lit patch below and
   around it. All of them share a handful of materials, so a single per-frame
   NightLights.set(dayF) fades every light in the world in and out together —
   full at night, invisible by day. Everything not lit stays dark.
   ========================================================================= */
import { THREE } from '../core/three.js';

/* soft radial disc: white at the centre fading to transparent at the rim, so an
   additive quad textured with it paints a gentle pool rather than a hard circle. */
function radialTex(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');
  const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.45,'rgba(255,255,255,0.55)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,128,128);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;
}
const TEX=radialTex();

// One additive material per colour; opacity is the only thing that changes, so
// updating it once fades every pool of that colour at once.
function poolMat(hex){return new THREE.MeshBasicMaterial({map:TEX,color:hex,transparent:true,
  opacity:0,blending:THREE.AdditiveBlending,depthWrite:false});}
function bulbMat(hex){return new THREE.MeshBasicMaterial({color:hex,transparent:true,
  opacity:0,blending:THREE.AdditiveBlending,depthWrite:false});}

const POOL_AMBER=poolMat(0xffca6a), POOL_WHITE=poolMat(0xbfe6ff);
const BULB_AMBER=bulbMat(0xffe6b0), BULB_WHITE=bulbMat(0xfff4d8);
const POLE_MAT=new THREE.MeshStandardMaterial({color:0x14171c,roughness:0.7,metalness:0.3,flatShading:true});

// Shared geometry — never disposed (lamps/pools are removed from the scene on
// chunk unload but the geometry lives for the whole session).
const POOL_GEO=new THREE.PlaneGeometry(2,2);POOL_GEO.rotateX(-Math.PI/2);   // flat disc, "radius 1"
const BULB_GEO=new THREE.SphereGeometry(0.42,8,8);
const POLE_GEO=new THREE.CylinderGeometry(0.11,0.17,9,6);
const ARM_GEO =new THREE.BoxGeometry(1.7,0.16,0.16);

/* A ground pool of the given radius/material, laid flat just above the ground. */
function pool(mat,r){
  const m=new THREE.Mesh(POOL_GEO,mat);
  m.scale.set(r,1,r);m.position.y=0.25;m.renderOrder=2;
  return m;
}

/* A roadside street lamp: dark pole, a glowing bulb on a short arm reaching over
   the road, and an amber pool on the tarmac below. Built in world units. The arm
   points along local +X, so the placer rotates the lamp to hang it over the road. */
export function streetLamp(){
  const g=new THREE.Group();
  const pole=new THREE.Mesh(POLE_GEO,POLE_MAT);pole.position.y=4.5;pole.castShadow=false;
  const arm=new THREE.Mesh(ARM_GEO,POLE_MAT);arm.position.set(0.85,8.7,0);
  const bulb=new THREE.Mesh(BULB_GEO,BULB_AMBER);bulb.position.set(1.7,8.5,0);
  const p=pool(POOL_AMBER,15);p.position.set(1.7,0.25,0);        // pool under the bulb, over the road
  g.add(pole,arm,bulb,p);
  g.userData.noAbduct=true;
  return g;
}

/* Lit forecourt for a gas station: a wide amber pool over the pumps. Returned so
   the station can parent it (it fades with every other night light). */
export function forecourtPool(r){ return pool(POOL_AMBER,r||13); }

/* Vehicle headlights: an elongated white pool cast forward (+Z is the nose), plus
   two bright bulbs. Parented to the car; hidden while it's off the ground. */
export function headlightRig(w,len,noseZ){
  const g=new THREE.Group();
  const p=new THREE.Mesh(POOL_GEO,POOL_WHITE);
  p.scale.set(w*0.9,1,len*0.5);p.position.set(0,0.2,noseZ+len*0.4);p.renderOrder=2;
  const bl=new THREE.Mesh(BULB_GEO,BULB_WHITE);bl.scale.setScalar(0.5);bl.position.set(-w*0.32,0.55,noseZ);
  const br=new THREE.Mesh(BULB_GEO,BULB_WHITE);br.scale.setScalar(0.5);br.position.set( w*0.32,0.55,noseZ);
  g.add(p,bl,br);
  return g;
}

/* Fade every light with the day/night factor (1 day, 0 night): lamps ramp on as
   it darkens and are full at deep night. A gentle amber flicker keeps them alive. */
let _flk=0;
export const NightLights={
  set(dayF, t){
    const k=Math.max(0,Math.min(1,(0.55-dayF)/0.55));    // 0 by day, 1 at night
    _flk=0.92+0.08*Math.sin((t||0)*7.3)+0.04*Math.sin((t||0)*19.1);
    POOL_AMBER.opacity=0.7*k*_flk;
    POOL_WHITE.opacity=0.85*k;
    BULB_AMBER.opacity=1.0*k*_flk;
    BULB_WHITE.opacity=1.0*k;
  },
};
