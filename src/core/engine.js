/* =========================================================================
   ENGINE — renderer, scene, camera, lights, stars, moon, and the tiny
   night-sky reflection env map. Evaluated before any mesh module (they import
   `scene` from here), so the world always has somewhere to be added.
   ========================================================================= */
import { THREE } from './three.js';
import { env } from './env.js';

const LOW_END = env.LOW_END;

export const app=document.getElementById('app');
export const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,LOW_END?1.5:2));
renderer.setSize(innerWidth,innerHeight);
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=0.92;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);
renderer.domElement.style.touchAction='none';
renderer.domElement.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});
renderer.domElement.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
renderer.domElement.addEventListener('dblclick',e=>e.preventDefault());
document.addEventListener('gesturestart',e=>e.preventDefault());

export const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x070e10,0.0062);
if(LOW_END)scene.fog.density=0.0092;

/* sky gradient background (default; world config overrides per world) */
(function(){
  const c=document.createElement('canvas');c.width=8;c.height=256;
  const g=c.getContext('2d').createLinearGradient(0,0,0,256);
  g.addColorStop(0,'#010203');g.addColorStop(0.55,'#040a0d');g.addColorStop(1,'#0a1416');
  const ctx=c.getContext('2d');ctx.fillStyle=g;ctx.fillRect(0,0,8,256);
  const tex=new THREE.CanvasTexture(c);tex.encoding=THREE.sRGBEncoding;scene.background=tex;
})();

export const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,0.5,1400);
camera.position.set(0,50,90);

/* lights */
export const hemi=new THREE.HemisphereLight(0x2c4450,0x050708,0.42);scene.add(hemi);
export const sun=new THREE.DirectionalLight(0x8fb2c8,0.7);
sun.position.set(60,90,30);sun.castShadow=true;
sun.shadow.mapSize.set(LOW_END?512:1024,LOW_END?512:1024);
const sc=sun.shadow.camera;sc.near=10;sc.far=300;sc.left=-95;sc.right=95;sc.top=95;sc.bottom=-95;
sun.shadow.bias=-0.0008;
scene.add(sun);scene.add(sun.target);

/* stars + pale moon (fog-exempt, follow the camera) */
export const stars=(function(){
  const N=800,pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){
    const a=Math.random()*Math.PI*2, e=Math.acos(Math.random()*0.85); // upper dome
    const r=900;
    pos[i*3]=r*Math.sin(e)*Math.cos(a); pos[i*3+1]=r*Math.cos(e); pos[i*3+2]=r*Math.sin(e)*Math.sin(a);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const m=new THREE.PointsMaterial({color:0x6f8494,size:1.5,sizeAttenuation:false,transparent:true,opacity:0.7,fog:false,depthWrite:false});
  const p=new THREE.Points(g,m);scene.add(p);return p;
})();
export const moon=(function(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const x=c.getContext('2d');
  const gr=x.createRadialGradient(64,64,10,64,64,64);
  gr.addColorStop(0,'rgba(205,220,225,0.9)');gr.addColorStop(0.35,'rgba(160,180,190,0.5)');gr.addColorStop(1,'rgba(160,180,190,0)');
  x.fillStyle=gr;x.fillRect(0,0,128,128);
  const tex=new THREE.CanvasTexture(c);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,fog:false,depthWrite:false,opacity:0.85}));
  sp.scale.set(130,130,1);scene.add(sp);return sp;
})();

/* Night-sky reflection env so metallic surfaces catch colour + a moon highlight.
   A small procedural equirect (dark horizon gradient, a soft moon glow, a few
   star specks) is PMREM-prefiltered into a proper IBL map — no external HDRI,
   so it stays a single self-contained file. Used both as per-material envMap
   (assets.js) and, in Cinematic mode, as scene.environment (postfx.setFX). */
let ENVMAP=null;
export function getEnv(){
  if(ENVMAP)return ENVMAP;
  try{
    const W=256,H=128;
    const c=document.createElement('canvas');c.width=W;c.height=H;
    const x=c.getContext('2d');
    // deep sky → moonlit horizon gradient (kept dark to preserve the mood)
    const g=x.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#0a1420');g.addColorStop(0.42,'#16303f');g.addColorStop(0.62,'#1d3b4b');
    g.addColorStop(0.8,'#0c161c');g.addColorStop(1,'#04070a');
    x.fillStyle=g;x.fillRect(0,0,W,H);
    // faint stars in the upper band
    x.fillStyle='rgba(180,205,215,0.5)';
    for(let i=0;i<70;i++){const sx=Math.random()*W, sy=Math.random()*H*0.4;x.fillRect(sx,sy,1,1);}
    // a soft moon glow — a bright spot the metal saucer can catch as a highlight
    const mx=W*0.72, my=H*0.34, gr=x.createRadialGradient(mx,my,1,mx,my,26);
    gr.addColorStop(0,'rgba(220,232,236,0.95)');gr.addColorStop(0.4,'rgba(150,180,192,0.5)');gr.addColorStop(1,'rgba(150,180,192,0)');
    x.fillStyle=gr;x.beginPath();x.arc(mx,my,26,0,7);x.fill();
    const tex=new THREE.CanvasTexture(c);
    tex.mapping=THREE.EquirectangularReflectionMapping;
    tex.encoding=THREE.sRGBEncoding;
    const pm=new THREE.PMREMGenerator(renderer);
    ENVMAP=pm.fromEquirectangular(tex).texture;
    pm.dispose();tex.dispose();
  }catch(e){}
  return ENVMAP;
}
