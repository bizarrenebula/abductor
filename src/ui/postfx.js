/* =========================================================================
   POST FX — self-contained half-res color grade + vignette (bloom scaffolding
   retained but disabled). Post is fragile on iOS Safari, so setFX('basic')
   falls back to direct rendering; renderFrame catches a failed compose and
   drops to basic automatically.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { renderer, scene, camera } from '../core/engine.js';
import { refreshHemi } from '../world/world-config.js';

let rtScene,rtHalfA,rtHalfB;
function makeRT(w,h){return new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat});}
export function allocRT(){
  const w=innerWidth,h=innerHeight,bw=Math.max(1,w>>1),bh=Math.max(1,h>>1);
  if(rtScene)rtScene.dispose();if(rtHalfA)rtHalfA.dispose();if(rtHalfB)rtHalfB.dispose();
  rtScene=makeRT(w,h);rtScene.texture.encoding=THREE.sRGBEncoding;
  rtHalfA=makeRT(bw,bh);rtHalfB=makeRT(bw,bh);
}
allocRT();
const fxCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const fxScene=new THREE.Scene();
const fxQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));fxScene.add(fxQuad);
const FSV=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const brightMat=new THREE.ShaderMaterial({uniforms:{tDiffuse:{value:null},threshold:{value:0.6}},vertexShader:FSV,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float threshold;varying vec2 vUv;
    void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float l=dot(c,vec3(0.299,0.587,0.114));
    gl_FragColor=vec4(c*smoothstep(threshold,threshold+0.3,l),1.0);}`});
const blurMat=new THREE.ShaderMaterial({uniforms:{tDiffuse:{value:null},dir:{value:new THREE.Vector2()}},vertexShader:FSV,
  fragmentShader:`uniform sampler2D tDiffuse;uniform vec2 dir;varying vec2 vUv;
    void main(){vec3 s=texture2D(tDiffuse,vUv).rgb*0.227027;
    s+=texture2D(tDiffuse,vUv+dir*1.3846).rgb*0.316216;
    s+=texture2D(tDiffuse,vUv-dir*1.3846).rgb*0.316216;
    s+=texture2D(tDiffuse,vUv+dir*3.2308).rgb*0.070270;
    s+=texture2D(tDiffuse,vUv-dir*3.2308).rgb*0.070270;
    gl_FragColor=vec4(s,1.0);}`});
const compMat=new THREE.ShaderMaterial({uniforms:{tScene:{value:null},tBloom:{value:null},bloomK:{value:0.0}},vertexShader:FSV,
  fragmentShader:`uniform sampler2D tScene;uniform sampler2D tBloom;uniform float bloomK;varying vec2 vUv;
    void main(){vec3 sc=texture2D(tScene,vUv).rgb;vec3 bl=texture2D(tBloom,vUv).rgb;
    vec3 col=sc+bl*bloomK;
    float l=dot(col,vec3(0.299,0.587,0.114));
    col=mix(vec3(l),col,0.86);           // keep more chroma
    col*=vec3(0.9,0.98,1.08);            // cool tint
    col=(col-0.5)*1.1+0.5;               // contrast
    col=max(col-0.02,0.0);               // crush blacks
    vec2 q=vUv-0.5;float vig=1.0-smoothstep(0.32,0.98,length(q));
    col*=mix(0.68,1.0,vig);              // vignette (CSS veil adds more)
    gl_FragColor=vec4(col,1.0);}`});
function fxPass(m,target){fxQuad.material=m;renderer.setRenderTarget(target||null);renderer.render(fxScene,fxCam);}
function composeRender(){
  // bloom removed: render the scene, then apply only the color grade + vignette
  renderer.setRenderTarget(rtScene);renderer.render(scene,camera);
  compMat.uniforms.tScene.value=rtScene.texture;compMat.uniforms.tBloom.value=rtScene.texture;
  fxPass(compMat,null);
  renderer.setRenderTarget(null);
}

/* ---- effects mode: post-processing is fragile on iOS Safari, so default
   to a direct-render Basic mode there, with a live toggle + crash fallback ---- */
export function setFX(name){
  env.usePost=(name==='full');
  // basic mode loses bloom+grade, so lift exposure/ambience to stay readable
  renderer.toneMappingExposure=env.usePost?1.08:1.18;
  refreshHemi();
}
export function renderFrame(){
  if(env.usePost){
    try{composeRender();return;}
    catch(e){ setFX('basic'); try{renderer.setRenderTarget(null);}catch(_){} }
  }
  renderer.render(scene,camera);
}
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();},false);
renderer.domElement.addEventListener('webglcontextrestored',()=>{allocRT();},false);
