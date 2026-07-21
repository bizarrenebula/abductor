/* =========================================================================
   BEAM — the tractor cone + ground impact disc (both shader meshes) and the
   effective beam radius (widened by the WIDE MAW buff).
   ========================================================================= */
import { THREE } from '../core/three.js';
import { scene } from '../core/engine.js';
import { S } from '../core/state.js';
import { buff } from './buffs.js';

export const beamMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uPow:{value:1}},
  vertexShader:`varying float vY;void main(){vY=position.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying float vY;uniform float uTime;uniform float uPow;
    void main(){ float t=vY+0.5;
      float a=mix(0.05,0.45,t)+0.07*sin(t*46.0-uTime*8.0);
      float flick=0.82+0.18*sin(uTime*31.7)*sin(uTime*17.3);
      vec3 col=mix(vec3(0.30,0.75,0.55),vec3(0.80,1.0,0.90),t);
      gl_FragColor=vec4(col,clamp(a,0.0,1.0)*0.8*flick*uPow); }`
});
export const beam=new THREE.Mesh(new THREE.ConeGeometry(1,1,40,1,true),beamMat);
scene.add(beam);

export const discMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  uniforms:{uTime:{value:0},uPow:{value:1}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying vec2 vUv;uniform float uTime;uniform float uPow;
    void main(){ float r=distance(vUv,vec2(0.5))*2.0;
      float ring=smoothstep(0.72,0.96,r)*(1.0-smoothstep(0.96,1.06,r));
      float inner=(1.0-smoothstep(0.0,1.0,r))*0.2;
      float pulse=0.6+0.4*sin(uTime*4.0);
      float a=(ring*0.85+inner)*pulse*uPow;
      gl_FragColor=vec4(vec3(0.35,1.0,0.72),a); }`
});
export const disc=new THREE.Mesh(new THREE.CircleGeometry(1,64),discMat);
disc.rotation.x=-Math.PI/2;scene.add(disc);

export function effBeamR(){return S.beamR*(buff==='wide'?1.6:1);}
