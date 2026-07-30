/* =========================================================================
   BEAM — the tractor cone + ground impact disc (both shader meshes), a rising
   "energy spark" particle column, and the effective beam radius (widened by the
   WIDE MAW buff).

   The beam reacts to an in-progress abduction lock (S.beamLock, 0..1): the cone
   brightens and shifts from cyan toward warm gold, a ring on the ground sweeps
   outward as the lock fills, and the sparks quicken — so the player gets clear,
   in-world feedback that a creature is being taken (no HUD bar needed).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { buff } from './buffs.js';

export const beamMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uPow:{value:1},uLock:{value:0}},
  vertexShader:`varying float vY;void main(){vY=position.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying float vY;uniform float uTime;uniform float uPow;uniform float uLock;
    void main(){ float t=vY+0.5;                                  // 0 bottom → 1 top
      float bands=0.5+0.5*sin(t*26.0-uTime*7.0);                  // energy bands scrolling UP the column
      float a=mix(0.06,0.5,t)+0.11*bands+0.06*sin(t*46.0-uTime*8.0);
      float flick=0.82+0.18*sin(uTime*31.7)*sin(uTime*17.3);
      vec3 base=mix(vec3(0.16,0.66,0.95),vec3(0.72,0.96,1.0),t);  // cyan tractor beam
      vec3 lock=mix(vec3(0.98,0.80,0.30),vec3(1.0,0.98,0.86),t);  // warm gold while locking
      vec3 col=mix(base,lock,uLock*0.85);
      a*=(1.0+0.9*uLock);                                         // brighter as the lock fills
      gl_FragColor=vec4(col,clamp(a,0.0,1.0)*0.8*flick*uPow); }`
});
export const beam=new THREE.Mesh(new THREE.ConeGeometry(1,1,40,1,true),beamMat);
scene.add(beam);

export const discMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uPow:{value:1},uLock:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying vec2 vUv;uniform float uTime;uniform float uPow;uniform float uLock;
    void main(){ float r=distance(vUv,vec2(0.5))*2.0;
      float ring=smoothstep(0.72,0.96,r)*(1.0-smoothstep(0.96,1.06,r));
      float inner=(1.0-smoothstep(0.0,1.0,r))*0.2;
      float pulse=0.6+0.4*sin(uTime*4.0);
      // a bright ring that sweeps outward as the lock fills — an in-world progress meter
      float lr=smoothstep(uLock-0.06,uLock,r)*(1.0-smoothstep(uLock,uLock+0.06,r));
      float a=(ring*0.85+inner)*pulse*uPow + lr*1.4*uLock;
      vec3 col=mix(vec3(0.26,0.86,1.0),vec3(1.0,0.92,0.55),uLock*0.9);
      gl_FragColor=vec4(col,a); }`
});
export const disc=new THREE.Mesh(new THREE.CircleGeometry(1,64),discMat);
disc.rotation.x=-Math.PI/2;scene.add(disc);

/* ---- rising energy sparks -------------------------------------------------
   A column of glowing motes that stream UP the beam. Cheap (one Points object,
   no per-frame allocation); they recycle at the bottom and ride the beam radius,
   quickening + brightening while a lock is building. */
const SPARKS=72;
const _sr=new Float32Array(SPARKS), _sa=new Float32Array(SPARKS),
      _sy=new Float32Array(SPARKS), _ss=new Float32Array(SPARKS);
for(let i=0;i<SPARKS;i++){ _sr[i]=Math.sqrt(Math.random()); _sa[i]=Math.random()*6.283;
  _sy[i]=Math.random(); _ss[i]=0.5+Math.random()*0.9; }
const sparkPos=new Float32Array(SPARKS*3);
const sparkGeo=new THREE.BufferGeometry();
sparkGeo.setAttribute('position',new THREE.BufferAttribute(sparkPos,3));
function sparkTex(){
  const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.4,'rgba(200,240,255,0.6)');
  g.addColorStop(1,'rgba(160,220,255,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);
  const tx=new THREE.CanvasTexture(c);tx.encoding=THREE.sRGBEncoding;return tx;
}
const sparkMat=new THREE.PointsMaterial({size:2.4,map:sparkTex(),transparent:true,
  depthWrite:false,blending:THREE.AdditiveBlending,color:0xbfefff,sizeAttenuation:true,opacity:0});
export const sparks=new THREE.Points(sparkGeo,sparkMat);
sparks.frustumCulled=false;sparks.visible=false;scene.add(sparks);

/* Position/animate the spark column. cx,cz = beam axis; botY/topY = ground→hull;
   radius = current beam radius; pow = beam visibility 0..1; lock = 0..1. */
export function updateBeamFX(dt,cx,cz,botY,topY,radius,pow,lock){
  if(pow<=0.02){ sparks.visible=false; sparkMat.opacity=0; return; }
  sparks.visible=true;
  const span=Math.max(1,topY-botY);
  const rise=(0.55+0.9*lock);                       // sparks quicken as the lock builds
  for(let i=0;i<SPARKS;i++){
    _sy[i]+=_ss[i]*rise*dt/span*22;                 // climb, normalized to the column height
    if(_sy[i]>1){ _sy[i]-=1; _sr[i]=Math.sqrt(Math.random()); _sa[i]=Math.random()*6.283; }
    const y=_sy[i];
    const rr=_sr[i]*radius*(0.35+0.75*y);            // widen toward the top (cone)
    sparkPos[i*3]  =cx+Math.cos(_sa[i])*rr;
    sparkPos[i*3+1]=botY+y*span;
    sparkPos[i*3+2]=cz+Math.sin(_sa[i])*rr;
  }
  sparkGeo.attributes.position.needsUpdate=true;
  sparkMat.opacity=pow*(0.5+0.5*lock);
  sparkMat.size=2.2+2.0*lock;
  sparkMat.color.setRGB(0.75+0.25*lock,0.94,1.0-0.35*lock);   // cyan → warm as it locks
}

// S.upBeam is the gradual beam-width upgrade (1 at the start); the WIDE MAW buff
// stacks a temporary ×1.6 on top of whatever the ship has earned.
export function effBeamR(){return S.beamR*(S.upBeam||1)*(buff==='wide'?1.6:1);}
