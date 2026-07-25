/* =========================================================================
   SAUCER — the player ship (procedural fallback body + rim lights), its glow
   lights, and the floating energy bar that hovers above it.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { lerp } from '../core/math.js';
import { scene, camera } from '../core/engine.js';
import { S } from '../core/state.js';

export const saucer=new THREE.Group();
(function(){
  // The UFO is the one MATHEMATICALLY PERFECT object in a hand-crafted, imperfect
  // world (art brief): a clean, smooth metallic disc — NOT flat-shaded, so it
  // reads alien against the faceted terrain — with soft cyan tech-glow.
  const CY=0x35d6ff;                                   // signature soft cyan
  const hull=new THREE.Mesh(
    new THREE.SphereGeometry(5,48,24),                 // high segments = a true circle
    new THREE.MeshStandardMaterial({color:0xaebccb,metalness:0.94,roughness:0.22,
      emissive:0x1f8aa8,emissiveIntensity:0.5})        // brighter cyan sheen so the hull self-lights
  );
  hull.scale.set(1,0.28,1);hull.castShadow=true;saucer.add(hull);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(5,0.5,16,64),
    new THREE.MeshStandardMaterial({color:0x39424c,metalness:1,roughness:0.32}));
  rim.rotation.x=Math.PI/2;saucer.add(rim);
  // a single clean glowing cyan ring under the rim — the UFO's calling card
  const glowRing=new THREE.Mesh(new THREE.TorusGeometry(4.55,0.13,12,72),
    new THREE.MeshBasicMaterial({color:0x7fe8ff,transparent:true,opacity:0.9,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  glowRing.rotation.x=Math.PI/2;glowRing.position.y=-0.34;saucer.add(glowRing);saucer.userData.glowRing=glowRing;
  const dome=new THREE.Mesh(new THREE.SphereGeometry(2.4,36,22,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0xd6f6ff,metalness:0.1,roughness:0.04,
      transparent:true,opacity:0.62,emissive:0x59d9ff,emissiveIntensity:1.6}));  // the glowing "lid"
  dome.position.y=1.1;saucer.add(dome);saucer.userData.dome=dome;
  const under=new THREE.Mesh(new THREE.SphereGeometry(3.2,36,18,0,Math.PI*2,Math.PI/2,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x232b33,metalness:0.9,roughness:0.4}));
  under.position.y=-0.4;saucer.add(under);
  // a ring of small cyan lights around the border — they blink in a chase
  const lights=new THREE.Group();
  const NLIGHTS=16;
  for(let i=0;i<NLIGHTS;i++){
    const a=i/NLIGHTS*Math.PI*2;
    const b=new THREE.Mesh(new THREE.SphereGeometry(0.28,10,10),
      new THREE.MeshBasicMaterial({color:0xbdf4ff,transparent:true,
        blending:THREE.AdditiveBlending,depthWrite:false}));
    b.position.set(Math.cos(a)*4.85,-0.12,Math.sin(a)*4.85);
    lights.add(b);
  }
  saucer.add(lights);saucer.userData.lights=lights;
  // hull/dome/under/rim/ring are the fallback body; tag them so we can hide them
  saucer.userData.procBody=[hull,rim,glowRing,dome,under];
  saucer.userData.hullMat=hull.material;
})();

/* Per-frame ship glow: the dome "lid" pulses in overlapping waves, the hull keeps
   a breathing cyan sheen, and the border lights blink in a chase around the rim —
   so the craft stays a bright focal point. Cloak dims the whole show. Opacity of
   the dome/hull is left to applyCloakVisual; here we only drive emissive + the
   rim lights (which the cloak pass skips). */
export function updateSaucer(t){
  const cf=S.cloak?0.3:1;
  const dome=saucer.userData.dome, hullMat=saucer.userData.hullMat, rim=saucer.userData.lights;
  // two overlapping sines read as a slow wave washing across the lid
  const wave=0.5+0.32*Math.sin(t*2.1)+0.18*Math.sin(t*3.7+1.1);
  if(dome)dome.material.emissiveIntensity=(0.9+2.0*wave)*cf;
  if(hullMat)hullMat.emissiveIntensity=(0.4+0.28*wave)*cf;
  if(rim){
    const N=rim.children.length;
    for(let i=0;i<N;i++){
      const ph=i/N*Math.PI*2;
      // a sharp pulse whose phase advances with the index = a blip running the rim
      const b=0.22+0.78*Math.pow(0.5+0.5*Math.sin(t*3.2-ph*2),4);
      const m=rim.children[i].material; if(m)m.opacity=b*cf;
    }
  }
}
scene.add(saucer);
saucer.position.set(0,40,0);
// YXZ so yaw (heading) is applied first and the pitch/roll bank in the ship's
// own frame — otherwise a large heading would smear the banking axes.
saucer.rotation.order='YXZ';

/* saucer glow point light (cyan tech light) */
export const beamLight=new THREE.PointLight(0x40d8ff,0,60,2);
scene.add(beamLight);
/* soft running light: the ship glows cyan and lights the ground below */
export const shipLight=new THREE.PointLight(0xa6ecff,0.85,50,2);
scene.add(shipLight);
/* ground pool: a bright cyan-white circle of light the ship casts on the terrain
   below and around it, so the play area reads at night while everything past the
   pool falls off to black. decay 2 = a natural, quick edge into the surrounding
   darkness (the point is that the dark stays all around). Intensity set per frame,
   night-weighted, in the main loop. */
export const glowLight=new THREE.PointLight(0xcfe8ff,0,170,2);
scene.add(glowLight);

/* floating energy bar above the saucer — shows while beaming or when low */
const EB_W=6.6;
const ebar3=new THREE.Group();
const ebarBG=new THREE.Mesh(new THREE.PlaneGeometry(7.2,0.8),
  new THREE.MeshBasicMaterial({color:0x08110c,transparent:true,opacity:0,depthTest:false}));
const ebarFill3=new THREE.Mesh(new THREE.PlaneGeometry(EB_W,0.44),
  new THREE.MeshBasicMaterial({color:0x59ffb0,transparent:true,opacity:0,depthTest:false}));
ebarFill3.position.z=0.02;
ebarBG.renderOrder=998;ebarFill3.renderOrder=999;
ebar3.add(ebarBG);ebar3.add(ebarFill3);
scene.add(ebar3);
export { ebarBG, ebarFill3 };
export function updateEnergyBar(dt,show){
  const tgt=show?1:0;
  ebarBG.material.opacity=lerp(ebarBG.material.opacity,tgt*0.55,Math.min(1,dt*6));
  ebarFill3.material.opacity=lerp(ebarFill3.material.opacity,tgt*0.95,Math.min(1,dt*6));
  ebar3.position.set(saucer.position.x,saucer.position.y+7.5,saucer.position.z);
  ebar3.quaternion.copy(camera.quaternion);
  const e=Math.max(0.001,S.energy);
  ebarFill3.scale.x=e;
  ebarFill3.position.x=-(1-e)*EB_W/2;
  ebarFill3.material.color.setHex(S.energy<0.28?0xff5040:0x59ffb0);
}
