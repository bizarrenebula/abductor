/* =========================================================================
   WATER — a single large following plane with an animated surface shader.
   Toggled per-world via water.visible (see world-config applyWorld).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { env } from '../core/env.js';
import { WATER_Y } from '../core/constants.js';
import { scene } from '../core/engine.js';
import { waterNoiseTex } from './textures.js';

const LOW_END = env.LOW_END;

export const waterMat=new THREE.ShaderMaterial({
  transparent:true,uniforms:{uTime:{value:0},uCam:{value:new THREE.Vector3()},uSun:{value:new THREE.Vector3(0.5,0.8,0.3)},uMoonF:{value:0.0},uTex:{value:waterNoiseTex},uFog:{value:scene.fog.color},uFogD:{value:scene.fog.density}},
  vertexShader:`uniform float uTime;varying vec3 vW;varying float vWave;
    // sum of directional waves for a layered, non-uniform surface
    float wave(vec2 p,vec2 dir,float len,float spd,float t){
      return sin(dot(dir,p)*len + t*spd);
    }
    void main(){ vec3 p=position; vec4 wp=modelMatrix*vec4(p,1.0); vec2 xz=wp.xz;
      float t=uTime;
      float h =wave(xz,normalize(vec2( 1.0,0.3)),0.09,1.1,t)*0.34;
      h+=wave(xz,normalize(vec2(-0.4,1.0)),0.14,1.5,t)*0.22;
      h+=wave(xz,normalize(vec2( 0.7,-0.6)),0.26,2.1,t)*0.11;
      h+=wave(xz,normalize(vec2(-1.0,-0.2)),0.5,3.0,t)*0.05;
      p.y+=h; vWave=h;
      vW=(modelMatrix*vec4(p,1.0)).xyz;
      vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv; }`,
  fragmentShader:`varying vec3 vW;varying float vWave;uniform vec3 uCam;uniform vec3 uSun;uniform float uMoonF;uniform vec3 uFog;uniform float uFogD;uniform sampler2D uTex;uniform float uTime;
    // reconstruct a detailed normal by sampling wave height derivatives from noise + analytic ripples
    void main(){ vec3 v=normalize(uCam-vW);
      // two scrolling noise layers for fine ripple detail
      vec2 uvA=vW.xz*0.05 + vec2(uTime*0.015,uTime*0.010);
      vec2 uvB=vW.xz*0.13 - vec2(uTime*0.022,uTime*0.008);
      float nA=texture2D(uTex,uvA).r, nB=texture2D(uTex,uvB).r;
      // finite-difference normal from the noise field (fine chop) blended with the big wave slope
      float e=0.6;
      float hx=texture2D(uTex,uvA+vec2(e*0.05,0.0)).r - texture2D(uTex,uvA-vec2(e*0.05,0.0)).r;
      float hz=texture2D(uTex,uvA+vec2(0.0,e*0.05)).r - texture2D(uTex,uvA-vec2(0.0,e*0.05)).r;
      vec3 nrm=normalize(vec3(-(hx+ (nB-0.5))*1.6, 1.0, -(hz+ (nA-0.5))*1.6));
      float rip=nA*0.6+nB*0.4;
      // fresnel: transparent/dark looking straight down, reflective at grazing angles
      float fres=pow(1.0-clamp(dot(nrm,v),0.0,1.0),4.0);
      // depth colour: deep teal-black in the troughs, brighter on the crests
      vec3 deep=vec3(0.004,0.035,0.055);
      vec3 shallow=vec3(0.05,0.24,0.28);
      vec3 col=mix(deep,shallow,clamp(vWave*0.5+0.5,0.0,1.0));
      // sky/horizon reflection tint grows with fresnel
      vec3 skyRefl=mix(vec3(0.05,0.12,0.16),vec3(0.5,0.62,0.72),uMoonF);
      col=mix(col,skyRefl,fres*0.6);
      col*=0.8+0.4*rip;
      // specular highlight: tight warm sun by day, broad cool moon by night
      vec3 hlf=normalize(v+normalize(uSun));
      float sd=max(dot(nrm,hlf),0.0);
      vec3 dayGlint=pow(sd,120.0)*vec3(1.0,0.93,0.74)*2.2;
      vec3 moonGlint=pow(sd,26.0)*vec3(0.55,0.72,0.95)*1.1;
      col+=mix(moonGlint,dayGlint,uMoonF)*(0.6+0.8*rip);
      // fine sparkle: occasional bright glints on wave tips
      float spk=pow(max(nA*nB,0.0),8.0)*fres;
      col+=spk*mix(vec3(0.5,0.7,0.95),vec3(1.0,0.95,0.8),uMoonF)*2.5;
      float d=length(uCam-vW); float fog=1.0-exp(-uFogD*uFogD*d*d);
      col=mix(col,uFog,clamp(fog,0.0,1.0));
      // more transparent head-on, more opaque (reflective) at grazing angles
      float alpha=mix(0.72,0.97,fres);
      gl_FragColor=vec4(col,alpha); }`

});
export const water=new THREE.Mesh(new THREE.PlaneGeometry(700,700,LOW_END?90:150,LOW_END?90:150),waterMat);
water.geometry.rotateX(-Math.PI/2);
water.position.y=WATER_Y;scene.add(water);
