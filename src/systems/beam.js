/* =========================================================================
   BEAM — a dome of light: a bell-shaped shell with circular borders running up
   and down it, a fog volume lit from inside, a ground impact disc, the haze that
   spills off it onto the grass, a rising "energy spark" mote column, and the
   effective beam radius (widened by the WIDE MAW buff).

   The shell, the fog and the haze are three additive layers of one effect. The
   shell carries the moving borders and the silhouette, the fog fills the volume
   so it is not hollow, the haze puts it on the ground. Only the shell and the
   disc are placed by the main loop; the other two are their children.

   The beam reacts to an in-progress abduction lock (S.beamLock, 0..1): the dome
   brightens and shifts from cyan toward warm gold, a ring on the ground sweeps
   outward as the lock fills, and the sparks quicken — so the player gets clear,
   in-world feedback that a creature is being taken (no HUD bar needed).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { buff } from './buffs.js';

/* ---- the dome ------------------------------------------------------------
   A bell, not a cone. The profile flares gently as it falls, so the silhouette
   curves out into a skirt where it meets the ground instead of running dead
   straight — that curve is what reads as "a dome of light" rather than "a
   traffic cone". Built as a lathe so the shape lives in the geometry and the
   shader can stay about light.

   Kept to the same unit box the old cone used — height 1 centred on 0, radius 1
   at the ground — so everything that positions and scales the beam is unchanged.
   The top is 0.18 rather than a point: the light leaves the hull as a shaft of
   some width, which is how it looks in every picture of one. */
const PROFILE=(()=>{
  const pts=[], N=18;
  for(let i=0;i<=N;i++){
    const t=i/N;                              // 0 at the ground, 1 at the hull
    const r=0.18+0.82*Math.pow(1-t,1.85);     // flare concentrated near the base
    pts.push(new THREE.Vector2(r,-0.5+t));
  }
  return pts;
})();

export const beamMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uPow:{value:1},uLock:{value:0}},
  vertexShader:`varying float vT; varying float vRim; varying vec2 vUv;
    void main(){
      vT=position.y+0.5;                       // 0 ground -> 1 hull
      vUv=uv;
      vec4 mv=modelViewMatrix*vec4(position,1.0);
      vec3 n=normalize(normalMatrix*normal);
      // 0 looking straight at the wall, 1 at the silhouette. A shell of light is
      // brightest where you look along it, which is what makes it read as a
      // hollow volume rather than a painted surface.
      vRim=1.0-abs(dot(n,normalize(-mv.xyz)));
      gl_Position=projectionMatrix*mv; }`,
  fragmentShader:`varying float vT; varying float vRim; varying vec2 vUv;
    uniform float uTime; uniform float uPow; uniform float uLock;
    /* One train of circular borders sliding along the dome. 'sharp' decides
       how band-like they are: low is a soft swell, high is a drawn ring. */
    float rings(float t,float count,float speed,float sharp){
      float p=fract(t*count-uTime*speed);
      return pow(1.0-abs(p*2.0-1.0),sharp);
    }
    void main(){
      // Two trains in opposite directions — borders running up the dome and
      // others settling back down it.
      float up  =rings(vT,3.0, 0.20,5.0);
      float down=rings(vT,2.0,-0.13,7.0);
      float band=up*0.55+down*0.45;

      float body=mix(0.085,0.030,vT);          // brightest where it meets the ground
      float rim =pow(vRim,2.2)*0.34;           // glass-shell edge
      float flick=0.9+0.1*sin(uTime*23.0)*sin(uTime*13.7);

      float a=(body+band*0.30+rim)*(1.0+0.5*uLock);
      vec3 base=mix(vec3(0.72,0.96,1.0),vec3(0.22,0.68,0.96),vT);   // pale at the floor
      vec3 lock=mix(vec3(1.0,0.97,0.84),vec3(0.98,0.78,0.30),vT);   // warm gold on a lock
      vec3 col=mix(base,lock,uLock*0.85);
      col+=band*0.30*uPow;                     // the borders themselves read white-hot
      gl_FragColor=vec4(col,clamp(a,0.0,1.0)*0.52*flick*uPow); }`
});
export const beam=new THREE.Mesh(new THREE.LatheGeometry(PROFILE,48),beamMat);
scene.add(beam);

/* ---- the fog inside it ---------------------------------------------------
   A second, slightly inset bell carrying a slow drifting haze. Additive and
   very soft, with no rings of its own: its whole job is to make the inside of
   the dome look full of lit fog instead of hollow. Parented to the beam so it
   inherits every placement and scale the main loop already does. */
export const fogMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uPow:{value:1},uLock:{value:0}},
  vertexShader:`varying float vT; varying vec2 vUv;
    void main(){ vT=position.y+0.5; vUv=uv;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`varying float vT; varying vec2 vUv;
    uniform float uTime; uniform float uPow; uniform float uLock;
    void main(){
      float a1=vUv.x*6.283;
      // two slow, out-of-step swirls: enough to look like moving vapour without
      // any texture or noise lookup
      float f=0.5+0.5*sin(vT*7.0-uTime*0.55+sin(a1*2.0+uTime*0.31)*1.6);
      float g=0.5+0.5*sin(vT*4.0+uTime*0.37+sin(a1*3.0-uTime*0.23)*1.2);
      float haze=mix(f,g,0.5);
      float a=mix(0.115,0.018,vT)*(0.45+0.55*haze)*(1.0+0.4*uLock);
      vec3 col=mix(vec3(0.66,0.92,1.0),vec3(1.0,0.93,0.72),uLock*0.8);
      gl_FragColor=vec4(col,clamp(a,0.0,1.0)*0.42*uPow); }`
});
const beamFog=new THREE.Mesh(new THREE.LatheGeometry(PROFILE,32),fogMat);
beamFog.scale.setScalar(0.9);
beam.add(beamFog);

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

/* ---- ground haze ---------------------------------------------------------
   Fog does not stop at the dome's skirt; it spills out and lies on the grass.
   A wide, very soft disc under the base sells the beam as something with air in
   it. Parented to the ground disc, so it picks up the same placement, scale and
   flat-on-the-terrain rotation the main loop already applies. */
export const hazeMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uPow:{value:1},uLock:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying vec2 vUv;uniform float uTime;uniform float uPow;uniform float uLock;
    void main(){
      vec2 d=vUv-vec2(0.5);
      float r=length(d)*2.0;
      float ang=atan(d.y,d.x);
      // a soft pool, breathed on by a slow lobed wobble so the edge creeps
      float wob=1.0+0.10*sin(ang*3.0+uTime*0.5)+0.07*sin(ang*5.0-uTime*0.31);
      float a=(1.0-smoothstep(0.0,0.92*wob,r));
      a=pow(a,2.2)*0.17;
      vec3 col=mix(vec3(0.62,0.90,1.0),vec3(1.0,0.92,0.68),uLock*0.8);
      gl_FragColor=vec4(col,a*uPow*(1.0+0.3*uLock)); }`
});
const haze=new THREE.Mesh(new THREE.CircleGeometry(2.3,48),hazeMat);
haze.position.z=-0.06;                    // disc is rotated flat, so -z is a hair above it
disc.add(haze);

/* ---- rising motes ---------------------------------------------------------
   Fine specks streaming UP through the dome — dust caught in the light rather
   than sparks. Deliberately tiny and numerous: big motes read as fireflies and
   fight the fog for attention, where small ones give the volume its grain.
   Cheap (one Points object, no per-frame allocation); they recycle at the
   bottom and ride the bell's radius, quickening while a lock is building. */
const SPARKS=150;
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
const sparkMat=new THREE.PointsMaterial({size:0.55,map:sparkTex(),transparent:true,
  depthWrite:false,blending:THREE.AdditiveBlending,color:0xbfefff,sizeAttenuation:true,opacity:0});
export const sparks=new THREE.Points(sparkGeo,sparkMat);
sparks.frustumCulled=false;sparks.visible=false;scene.add(sparks);

/* Position/animate the spark column. cx,cz = beam axis; botY/topY = ground→hull;
   radius = current beam radius; pow = beam visibility 0..1; lock = 0..1. */
export function updateBeamFX(dt,cx,cz,botY,topY,radius,pow,lock){
  /* The fog volume and the ground haze are children of the two meshes the main
     loop already places, so they need no transform here — only their uniforms,
     mirrored from the beam's. Done in one spot so main.js stays unaware of them. */
  fogMat.uniforms.uTime.value =beamMat.uniforms.uTime.value;
  hazeMat.uniforms.uTime.value=beamMat.uniforms.uTime.value;
  fogMat.uniforms.uPow.value  =beamMat.uniforms.uPow.value;
  hazeMat.uniforms.uPow.value =beamMat.uniforms.uPow.value;
  fogMat.uniforms.uLock.value =beamMat.uniforms.uLock.value;
  hazeMat.uniforms.uLock.value=beamMat.uniforms.uLock.value;

  if(pow<=0.02){ sparks.visible=false; sparkMat.opacity=0; return; }
  sparks.visible=true;
  const span=Math.max(1,topY-botY);
  const rise=(0.55+0.9*lock);                       // sparks quicken as the lock builds
  for(let i=0;i<SPARKS;i++){
    _sy[i]+=_ss[i]*rise*dt/span*22;                 // climb, normalized to the column height
    if(_sy[i]>1){ _sy[i]-=1; _sr[i]=Math.sqrt(Math.random()); _sa[i]=Math.random()*6.283; }
    const y=_sy[i];
    // follow the bell: wide where it meets the ground, narrow at the hull
    const rr=_sr[i]*radius*(0.18+0.82*Math.pow(1-y,1.85));
    sparkPos[i*3]  =cx+Math.cos(_sa[i])*rr;
    sparkPos[i*3+1]=botY+y*span;
    sparkPos[i*3+2]=cz+Math.sin(_sa[i])*rr;
  }
  sparkGeo.attributes.position.needsUpdate=true;
  sparkMat.opacity=pow*(0.5+0.5*lock);
  sparkMat.size=0.5+0.45*lock;                    // tiny motes, not fireflies
  sparkMat.color.setRGB(0.75+0.25*lock,0.94,1.0-0.35*lock);   // cyan → warm as it locks
}

// S.upBeam is the gradual beam-width upgrade (1 at the start); the WIDE MAW buff
// stacks a temporary ×1.6 on top of whatever the ship has earned.
export function effBeamR(){return S.beamR*(S.upBeam||1)*(buff==='wide'?1.6:1);}
