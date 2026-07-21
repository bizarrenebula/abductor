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

export const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,0.5,1400);
camera.position.set(0,60,80);

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

/* tiny night-sky reflection env so metallic GLB materials show color */
let ENVMAP=null;
export function getEnv(){
  if(ENVMAP)return ENVMAP;
  try{
    const c=document.createElement('canvas');c.width=64;c.height=32;
    const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,0,32);
    g.addColorStop(0,'#33495c');g.addColorStop(0.5,'#16222b');g.addColorStop(1,'#05080a');
    x.fillStyle=g;x.fillRect(0,0,64,32);
    const tex=new THREE.CanvasTexture(c);
    tex.mapping=THREE.EquirectangularReflectionMapping;
    const pm=new THREE.PMREMGenerator(renderer);
    ENVMAP=pm.fromEquirectangular(tex).texture;
    pm.dispose();tex.dispose();
  }catch(e){}
  return ENVMAP;
}
