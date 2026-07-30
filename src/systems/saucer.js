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
    new THREE.MeshStandardMaterial({color:0x080a0d,metalness:0.85,roughness:0.5,
      emissive:0x061419,emissiveIntensity:0.1})        // BLACK alien metal; soft (matte) IBL sheen gives it form
  );
  hull.scale.set(1,0.28,1);hull.castShadow=true;saucer.add(hull);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(5,0.5,16,64),
    new THREE.MeshStandardMaterial({color:0x05070a,metalness:0.8,roughness:0.5}));
  rim.rotation.x=Math.PI/2;saucer.add(rim);
  // a soft, blurred cyan ring under the rim — a diffuse glow that outlines the
  // black disc so the craft still reads as a focal silhouette at night
  const glowRing=new THREE.Mesh(new THREE.TorusGeometry(4.62,0.34,10,64),
    new THREE.MeshBasicMaterial({color:0x49b4d0,transparent:true,opacity:0.6,
      blending:THREE.AdditiveBlending,depthWrite:false}));
  glowRing.rotation.x=Math.PI/2;glowRing.position.y=-0.34;saucer.add(glowRing);saucer.userData.glowRing=glowRing;
  // the "lid": a dark glassy dome with only a faint inner glow
  const dome=new THREE.Mesh(new THREE.SphereGeometry(2.4,36,22,0,Math.PI*2,0,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x14252c,metalness:0.4,roughness:0.55,
      transparent:true,opacity:0.8,emissive:0x1a5266,emissiveIntensity:0.32}));
  dome.position.y=1.1;saucer.add(dome);saucer.userData.dome=dome;
  // the actual glow of the lid is a soft blurred halo billboard over the dome
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:soft,color:0x3fbdd8,
    transparent:true,opacity:0.0,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.scale.set(8.5,8.5,1);halo.position.y=1.4;saucer.add(halo);saucer.userData.halo=halo;
  const under=new THREE.Mesh(new THREE.SphereGeometry(3.2,36,18,0,Math.PI*2,Math.PI/2,Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x040507,metalness:0.5,roughness:0.7}));
  under.position.y=-0.4;saucer.add(under);
  // hull/dome/under/rim/ring are the fallback body; tag them so we can hide them
  saucer.userData.procBody=[hull,rim,glowRing,dome,under];
})();

/* Per-frame ship glow — kept soft and diffuse: a blurred halo over the lid
   breathes slowly and the faint dome glow drifts with it. Everything low-key so
   the craft stays dark and alien. Cloak dims it; the halo is a billboard the
   cloak opacity pass skips, so its fade is handled here. */
export function updateSaucer(t){
  if(shadowMark)shadowMark.visible=(S.state==='playing');   // shadow/aim only in-flight
  const cf=S.cloak?0.28:1;
  const dome=saucer.userData.dome, halo=saucer.userData.halo;
  // slow overlapping sines = a soft wash breathing over the lid
  const wave=0.5+0.32*Math.sin(t*1.5)+0.18*Math.sin(t*2.5+1.1);
  if(halo){ halo.material.opacity=(0.18+0.26*wave)*cf; const s=8.0+0.9*wave; halo.scale.set(s,s,1); }
  if(dome)dome.material.emissiveIntensity=(0.28+0.3*wave)*cf;
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

/* ---- ground shadow (aim aid) ----------------------------------------------
   A soft, natural dark blob DIRECTLY below the ship, tracking its x/z (not its
   altitude). It's a small grid mesh whose vertices are draped onto the terrain
   every frame — so on uneven ground (slopes, canyon steps) it follows the
   surface instead of clipping through and vanishing. No ring, no glow: it reads
   as the ship's shadow, and because it sits exactly under the hull it doubles as
   an aim aid for the beam. Always-visible in flight, even in daylight. */
const SH_SUB=8, SH_HALF=7;               // grid subdivisions + half-extent (units)
function buildShadowGeo(){
  const n=SH_SUB+1, verts=n*n;
  const pos=new Float32Array(verts*3), uv=new Float32Array(verts*2);
  const baseX=new Float32Array(verts), baseZ=new Float32Array(verts);
  let vi=0;
  for(let iz=0;iz<n;iz++)for(let ix=0;ix<n;ix++){
    const lx=(ix/SH_SUB*2-1)*SH_HALF, lz=(iz/SH_SUB*2-1)*SH_HALF;
    baseX[vi]=lx; baseZ[vi]=lz;
    pos[vi*3]=lx; pos[vi*3+1]=0; pos[vi*3+2]=lz;
    uv[vi*2]=ix/SH_SUB; uv[vi*2+1]=iz/SH_SUB;   // radial texture spans the grid → circular blob
    vi++;
  }
  const idx=[];
  for(let iz=0;iz<SH_SUB;iz++)for(let ix=0;ix<SH_SUB;ix++){
    const a=iz*n+ix, b=a+1, c=a+n, d=c+1;
    idx.push(a,c,b, b,c,d);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  g.setIndex(idx);
  g.userData={baseX,baseZ};
  return g;
}
const shadowMesh=new THREE.Mesh(buildShadowGeo(),
  new THREE.MeshBasicMaterial({map:shadowTex(),color:0x000000,transparent:true,
    opacity:0.4,depthWrite:false,side:THREE.DoubleSide,
    // Bias the fragment depth toward the camera so the shadow always wins the
    // depth test against the ground it lies on — it never gets absorbed by the
    // surface, while real occluders in front (hills, the hull) still cover it.
    polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
shadowMesh.renderOrder=2;
shadowMesh.frustumCulled=false;          // vertices move every frame; skip stale-bounds culling
scene.add(shadowMesh);
/* soft radial dark disc (opaque centre → transparent edge) for the shadow. */
function shadowTex(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');
  const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.55,'rgba(255,255,255,0.6)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,128,128);
  const tex=new THREE.CanvasTexture(c);tex.encoding=THREE.sRGBEncoding;return tex;
}
const shadowMark=shadowMesh;             // updateSaucer toggles visibility via this handle
/* `groundAt(x,z)` returns the terrain/road height at a world point (passed in so
   this module needn't import the terrain + road samplers and risk a cycle). */
export function updateShadow(groundAt){
  const g=shadowMesh.geometry, p=g.attributes.position;
  const {baseX,baseZ}=g.userData;
  const sx=saucer.position.x, sz=saucer.position.z;
  const gy0=groundAt(sx,sz);
  // Grow + fade a little with altitude, like a real shadow spreading and
  // softening as the caster rises — but never vanish, so it stays a usable aim
  // aid at any height.
  const agl=Math.max(1,saucer.position.y-gy0);
  const k=Math.max(0.4,Math.min(1,1-(agl-20)/170));
  const scale=0.9+0.4*k;
  shadowMesh.position.set(sx,0,sz);
  const m=0.95;   // neighbourhood half-step (~half the grid spacing) for the max sample
  for(let i=0;i<baseX.length;i++){
    const lx=baseX[i]*scale, lz=baseZ[i]*scale;
    const wx=sx+lx, wz=sz+lz;
    // Sit each vertex ABOVE the highest terrain in its cell, not just the point
    // under it — so the flat triangles between vertices can't poke through the
    // draped plane on faceted / stepped ground. Small lift on top of that.
    const h=Math.max(groundAt(wx,wz),groundAt(wx+m,wz),groundAt(wx-m,wz),
                     groundAt(wx,wz+m),groundAt(wx,wz-m));
    p.setXYZ(i, lx, h+0.3, lz);
  }
  p.needsUpdate=true;
  shadowMesh.material.opacity=(S.cloak?0.12:0.24)+0.24*k;
}

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
