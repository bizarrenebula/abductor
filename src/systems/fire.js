/* =========================================================================
   FIRE — a burning wreck: flame, smoke, embers and a scorch mark.

   Four cheap layers that together read as something actually on fire, rather
   than a lump with an orange emissive on it:

     FLAME   an additive cone whose shader licks and flickers. The licking is
             what sells it — a steady gradient reads as coloured glass, and real
             flame is never steady.
     SMOKE   a taller, wider cone drifting the other way in normal blending, so
             it darkens the sky behind it instead of glowing.
     EMBERS  a handful of specks rising and guttering out.
     SCORCH  a dark disc on the ground, because a fire that leaves the grass
             pristine looks pasted on.

   Every instance shares ONE material per layer — the per-fire variation comes
   from a seed the vertex shader derives from the object's own world position,
   so a hundred fires cost the same uniform updates as one and none of them
   flicker in step. No lights: this game lights its night from emissive
   materials (see systems/nightlights.js), and a point light per wreck would
   blow the shader's light count.
   ========================================================================= */
import { THREE } from '../core/three.js';

/* A seed in 0..2PI from the instance's world position. Placed in the vertex
   shader so it costs nothing per fragment and needs no per-instance uniform. */
const SEED_GLSL=`
  float fireSeed(){
    vec3 w=modelMatrix[3].xyz;
    return fract(sin(dot(w,vec3(12.9898,78.233,37.719)))*43758.5453)*6.2831853;
  }`;

export const flameMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0}},
  vertexShader:SEED_GLSL+`
    varying vec2 vUv; varying float vSeed;
    void main(){ vUv=uv; vSeed=fireSeed();
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`
    varying vec2 vUv; varying float vSeed; uniform float uTime;
    void main(){
      float t=vUv.y;                       // 0 at the base, 1 at the tip
      float a1=vUv.x*6.2831853;
      // Tongues: the flame's effective height wobbles around the cone, at two
      // rates, so the top edge is ragged and never repeats cleanly.
      float lick=sin(a1*3.0+uTime*7.0+vSeed)*0.5+0.5;
      float lick2=sin(a1*5.0-uTime*4.3+vSeed*1.7)*0.5+0.5;
      float top=0.45+0.55*mix(lick,lick2,0.5);
      float body=1.0-smoothstep(top*0.15,top,t);   // thins the whole way up
      // Guttering: the whole flame breathes, fast and irregularly.
      float gut=0.72+0.28*sin(uTime*11.0+vSeed*2.3)*sin(uTime*6.1+vSeed);
      // Thin toward the silhouette. Without this the cone is a solid faceted
      // carrot; with it you are looking through sheets of flame.
      float edge=0.42+0.58*pow(abs(sin(a1)),0.6);
      // Vertical striations. This is what stops a cone of gradient reading as a
      // solid object: real flame is separate tongues, not a filled shape.
      float stri=0.34+0.66*pow(abs(sin(a1*4.0+uTime*2.2+vSeed)),1.4);
      float a=body*gut*edge*stri*0.72;
      vec3 col=mix(vec3(1.0,0.42,0.06),vec3(0.85,0.10,0.02),smoothstep(0.25,0.95,t));
      col=mix(vec3(1.0,0.96,0.72),col,smoothstep(0.0,0.30,t));   // white-hot at the root
      gl_FragColor=vec4(col,clamp(a,0.0,1.0)); }`
});

export const smokeMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,
  uniforms:{uTime:{value:0}},
  vertexShader:SEED_GLSL+`
    varying vec2 vUv; varying float vSeed; uniform float uTime;
    void main(){ vUv=uv; vSeed=fireSeed();
      vec3 p=position;
      // Lean and coil as it climbs — a straight smoke column looks like a pipe.
      float k=uv.y*uv.y;
      p.x+=sin(uTime*0.55+vSeed)*2.2*k;
      p.z+=cos(uTime*0.41+vSeed*1.3)*2.0*k;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
  fragmentShader:`
    varying vec2 vUv; varying float vSeed; uniform float uTime;
    void main(){
      float t=vUv.y;
      float a1=vUv.x*6.2831853;
      float puff=0.5+0.5*sin(t*5.0-uTime*1.1+sin(a1*2.0+vSeed)*1.4);
      // thickest just above the flame, gone by the top
      float a=smoothstep(0.0,0.20,t)*(1.0-smoothstep(0.40,1.0,t))*(0.35+0.65*puff)*0.15;
      vec3 col=mix(vec3(0.10,0.09,0.08),vec3(0.24,0.23,0.22),t);
      gl_FragColor=vec4(col,clamp(a,0.0,1.0)); }`
});

/* Scorch. A flat disc with a hard rim reads as a sticker on the grass, so the
   alpha comes from a radial gradient and the mark fades into the ground. */
function scorchTex(){
  const c=document.createElement('canvas');c.width=c.height=64;
  const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.55,'rgba(255,255,255,0.7)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
}
const scorchMat=new THREE.MeshBasicMaterial({color:0x0a0705,transparent:true,
  opacity:0.55,depthWrite:false,alphaMap:scorchTex()});

/* Embers share one material; each fire owns a small Points cloud so the specks
   can rise independently. */
const emberMat=new THREE.PointsMaterial({size:0.16,color:0xffb060,transparent:true,
  opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true});

const EMBERS=10;
const flameGeo=new THREE.ConeGeometry(1,1,20,6,true);
const smokeGeo=new THREE.ConeGeometry(1,1,16,6,true);
const scorchGeo=new THREE.CircleGeometry(1,18);

/* Attach a fire to an object. `scale` sizes the whole effect (1 ~ a burning
   chunk of hull). The returned group is already parented; update() walks the
   embers, everything else animates in its shaders. */
export function makeFire(parent,scale){
  const s=scale||1;
  const g=new THREE.Group();

  const scorch=new THREE.Mesh(scorchGeo,scorchMat);
  scorch.rotation.x=-Math.PI/2; scorch.position.y=0.06;
  scorch.scale.setScalar(2.1*s); g.add(scorch);

  const flame=new THREE.Mesh(flameGeo,flameMat);
  flame.scale.set(1.15*s,1.95*s,1.15*s);
  flame.position.y=1.0*s; g.add(flame);

  const smoke=new THREE.Mesh(smokeGeo,smokeMat);
  smoke.scale.set(1.25*s,6.5*s,1.25*s);
  smoke.position.y=4.2*s; g.add(smoke);

  const pos=new THREE.Float32BufferAttribute(new Float32Array(EMBERS*3),3);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',pos);
  const embers=new THREE.Points(geo,emberMat);
  embers.frustumCulled=false; g.add(embers);
  const life=new Float32Array(EMBERS), spd=new Float32Array(EMBERS),
        ang=new Float32Array(EMBERS), rad=new Float32Array(EMBERS);
  for(let i=0;i<EMBERS;i++){
    life[i]=Math.random(); spd[i]=0.6+Math.random()*0.9;
    ang[i]=Math.random()*6.283; rad[i]=Math.random()*0.7;
  }
  g.userData.fire={pos,life,spd,ang,rad,s};

  parent.add(g);
  return g;
}

/* One call per frame for the whole game: the shaders share their uniforms. */
export function updateFireTime(t){
  flameMat.uniforms.uTime.value=t;
  smokeMat.uniforms.uTime.value=t;
}

/* Walk one fire's embers. Cheap enough to call for every burning wreck. */
export function updateFire(g,dt){
  const f=g&&g.userData&&g.userData.fire;
  if(!f)return;
  const arr=f.pos.array;
  for(let i=0;i<EMBERS;i++){
    f.life[i]+=dt*f.spd[i]*0.5;
    if(f.life[i]>1){ f.life[i]-=1; f.ang[i]=Math.random()*6.283; f.rad[i]=Math.random()*0.7; }
    const y=f.life[i];
    // drift outward and wobble as they rise, then wink out at the top
    const r=(f.rad[i]+y*0.9)*f.s;
    arr[i*3]  =Math.cos(f.ang[i]+y*2.0)*r;
    arr[i*3+1]=(0.6+y*4.2)*f.s;
    arr[i*3+2]=Math.sin(f.ang[i]+y*2.0)*r;
  }
  f.pos.needsUpdate=true;
}
