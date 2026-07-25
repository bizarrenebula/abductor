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
  // A DARK, ALIEN METALLIC disc: matte (high-roughness, non-reflective) gunmetal,
  // brooding rather than shiny, with its glow coming from soft BLURRED halos
  // (additive billboards) rather than a bright hull — so it reads as an ominous
  // craft with a gentle wash of light, not a neon toy.
  const soft=softTex();
  const hull=new THREE.Mesh(
    new THREE.SphereGeometry(5,48,24),                 // high segments = a true circle
    new THREE.MeshStandardMaterial({color:0x3c444d,metalness:0.55,roughness:0.9,
      emissive:0x0a1c22,emissiveIntensity:0.14})       // matte dark metal, barely any sheen
  );
  hull.scale.set(1,0.28,1);hull.castShadow=true;saucer.add(hull);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(5,0.5,16,64),
    new THREE.MeshStandardMaterial({color:0x262c33,metalness:0.5,roughness:0.88}));
  rim.rotation.x=Math.PI/2;saucer.add(rim);
  // a soft, blurred cyan ring under the rim — a low, diffuse glow, not a hard line
  const glowRing=new THREE.Mesh(new THREE.TorusGeometry(4.6,0.28,10,64),
    new THREE.MeshBasicMaterial({color:0x2f8ba6,transparent:true,opacity:0.4,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  glowRing.rotation.x=Math.PI/2;glowRing.position.y=-0.34;saucer.add(glowRing);saucer.userData.glowRing=glowRing;
  // the "lid": a dark, matte glassy dome with only a faint inner glow
  const dome=new THREE.Mesh(new THREE.SphereGeometry(2.4,36,22,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x35505c,metalness:0.3,roughness:0.65,
      transparent:true,opacity:0.72,emissive:0x1d6076,emissiveIntensity:0.35}));
  dome.position.y=1.1;saucer.add(dome);saucer.userData.dome=dome;
  // the actual glow of the lid is a soft blurred halo billboard over the dome
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:soft,color:0x3fbdd8,
    transparent:true,opacity:0.0,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.scale.set(8.5,8.5,1);halo.position.y=1.4;saucer.add(halo);saucer.userData.halo=halo;
  const under=new THREE.Mesh(new THREE.SphereGeometry(3.2,36,18,0,Math.PI*2,Math.PI/2,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x161c22,metalness:0.4,roughness:0.9}));
  under.position.y=-0.4;saucer.add(under);
  // a ring of small, BLURRED lights around the border — soft glowing blobs
  // (billboards, so they read as a diffuse glow) that blink in a chase.
  const lights=new THREE.Group();
  const NLIGHTS=16;
  for(let i=0;i<NLIGHTS;i++){
    const a=i/NLIGHTS*Math.PI*2;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:soft,color:0x8fe6ff,
      transparent:true,opacity:0.0,blending:THREE.AdditiveBlending,depthWrite:false}));
    s.scale.set(1.5,1.5,1);
    s.position.set(Math.cos(a)*4.9,-0.12,Math.sin(a)*4.9);
    lights.add(s);
  }
  saucer.add(lights);saucer.userData.lights=lights;
  // hull/dome/under/rim/ring are the fallback body; tag them so we can hide them
  saucer.userData.procBody=[hull,rim,glowRing,dome,under];
})();

/* Per-frame ship glow — kept soft and diffuse: a blurred halo over the lid
   breathes slowly, the faint dome/ring glow drifts with it, and the small border
   halos blink in a gentle chase around the rim. Everything low-key so the craft
   stays dark and alien. Cloak dims it; the halos/sprites are billboards the cloak
   opacity pass skips, so their fade is handled here. */
export function updateSaucer(t){
  const cf=S.cloak?0.28:1;
  const dome=saucer.userData.dome, halo=saucer.userData.halo, rim=saucer.userData.lights;
  // slow overlapping sines = a soft wash breathing over the lid
  const wave=0.5+0.32*Math.sin(t*1.5)+0.18*Math.sin(t*2.5+1.1);
  if(halo){ halo.material.opacity=(0.14+0.22*wave)*cf; const s=8.0+0.9*wave; halo.scale.set(s,s,1); }
  if(dome)dome.material.emissiveIntensity=(0.25+0.28*wave)*cf;
  if(rim){
    const N=rim.children.length;
    for(let i=0;i<N;i++){
      const ph=i/N*Math.PI*2;
      // a soft pulse whose phase advances with the index = a blip drifting the rim
      const b=0.1+0.5*Math.pow(0.5+0.5*Math.sin(t*2.2-ph*2),3);
      const m=rim.children[i].material; if(m)m.opacity=b*cf;
    }
  }
}
/* soft radial disc for the blurred glows (white centre → transparent edge). */
function softTex(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');
  const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.4,'rgba(255,255,255,0.4)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,128,128);
  const tex=new THREE.CanvasTexture(c);tex.encoding=THREE.sRGBEncoding;return tex;
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
